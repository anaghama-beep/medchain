// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MedChain
/// @notice Patient-controlled medical records on Ethereum.
///
/// Medical data never touches the chain in plaintext. Each record is encrypted in
/// the browser with a fresh symmetric key; the ciphertext is published in an event
/// and its keccak256 hash is stored on-chain so any tampering is detectable. The
/// record key is wrapped (public-key encrypted) separately for every party allowed
/// to read it, and those wrapped keys are the only per-reader data kept here.
///
/// Roles:
///  - Admin: verifies healthcare providers.
///  - Provider: a verified clinician who can add records for patients who granted access.
///  - Patient: owns their records, grants and revokes provider access, redacts records.
contract MedChain {
    struct Provider {
        string name;
        string organisation;
        bool active;
    }

    struct Record {
        uint64 id;
        uint64 timestamp;
        uint64 supersedes; // id of the record this one amends, 0 if none
        bool redacted;
        address patient;
        address author;
        bytes32 contentHash; // keccak256 of the ciphertext
        string category;
    }

    address public admin;

    mapping(address => Provider) private _providers;
    address[] private _providerList;

    mapping(address => bool) public isPatient;
    /// X25519 public key used to wrap record keys for this account.
    mapping(address => bytes32) public encryptionKey;

    Record[] private _records; // index = id - 1
    mapping(address => uint256[]) private _patientRecords;

    /// patient => provider => access expiry (unix seconds); 0 means no access.
    mapping(address => mapping(address => uint64)) public accessExpiry;
    mapping(address => address[]) private _grantees;

    /// record id => reader => wrapped record key.
    mapping(uint256 => mapping(address => bytes)) private _wrappedKeys;

    event ProviderRegistered(address indexed provider, string name, string organisation);
    event ProviderStatusChanged(address indexed provider, bool active);
    event PatientRegistered(address indexed patient, bytes32 encryptionKey);
    event EncryptionKeySet(address indexed account, bytes32 encryptionKey);
    event AccessGranted(address indexed patient, address indexed provider, uint64 expiry);
    event AccessRevoked(address indexed patient, address indexed provider);
    event RecordAdded(
        uint256 indexed id,
        address indexed patient,
        address indexed author,
        string category,
        bytes32 contentHash,
        uint256 supersedes,
        bytes ciphertext
    );
    event RecordRedacted(uint256 indexed id, address indexed patient);
    event KeyShared(uint256 indexed id, address indexed reader);

    error NotAdmin();
    error NotActiveProvider();
    error NotPatient();
    error AlreadyRegistered();
    error MissingEncryptionKey(address account);
    error NoAccess();
    error UnknownRecord(uint256 id);
    error InvalidInput();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyPatient() {
        if (!isPatient[msg.sender]) revert NotPatient();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    // ------------------------------------------------------------------ identity

    function registerProvider(address provider, string calldata name, string calldata organisation)
        external
        onlyAdmin
    {
        if (provider == address(0) || bytes(name).length == 0) revert InvalidInput();
        if (bytes(_providers[provider].name).length == 0) _providerList.push(provider);
        _providers[provider] = Provider(name, organisation, true);
        emit ProviderRegistered(provider, name, organisation);
    }

    function setProviderActive(address provider, bool active) external onlyAdmin {
        if (bytes(_providers[provider].name).length == 0) revert InvalidInput();
        _providers[provider].active = active;
        emit ProviderStatusChanged(provider, active);
    }

    function registerPatient(bytes32 pubKey) external {
        if (isPatient[msg.sender]) revert AlreadyRegistered();
        if (pubKey == bytes32(0)) revert InvalidInput();
        isPatient[msg.sender] = true;
        encryptionKey[msg.sender] = pubKey;
        emit PatientRegistered(msg.sender, pubKey);
    }

    /// Providers (or anyone) publish the key that patients will wrap record keys to.
    function setEncryptionKey(bytes32 pubKey) external {
        if (pubKey == bytes32(0)) revert InvalidInput();
        encryptionKey[msg.sender] = pubKey;
        emit EncryptionKeySet(msg.sender, pubKey);
    }

    // ------------------------------------------------------------------ consent

    /// Grant a provider access until `expiry` and share the keys of existing records.
    /// The patient's client unwraps its own copy of each key and re-wraps it for the provider.
    function grantAccess(
        address provider,
        uint64 expiry,
        uint256[] calldata recordIds,
        bytes[] calldata wrappedKeys
    ) external onlyPatient {
        if (!_providers[provider].active) revert NotActiveProvider();
        if (encryptionKey[provider] == bytes32(0)) revert MissingEncryptionKey(provider);
        if (expiry <= block.timestamp || recordIds.length != wrappedKeys.length) revert InvalidInput();

        if (accessExpiry[msg.sender][provider] == 0) _grantees[msg.sender].push(provider);
        accessExpiry[msg.sender][provider] = expiry;
        emit AccessGranted(msg.sender, provider, expiry);

        for (uint256 i = 0; i < recordIds.length; i++) {
            Record storage r = _record(recordIds[i]);
            if (r.patient != msg.sender) revert NoAccess();
            _shareKey(recordIds[i], provider, wrappedKeys[i]);
        }
    }

    /// Revoke access and delete the provider's wrapped keys for this patient's records.
    /// Data the provider already decrypted cannot be recalled; this stops future reads.
    function revokeAccess(address provider) external onlyPatient {
        if (accessExpiry[msg.sender][provider] == 0) revert NoAccess();
        accessExpiry[msg.sender][provider] = 0;

        address[] storage list = _grantees[msg.sender];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == provider) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        uint256[] storage ids = _patientRecords[msg.sender];
        for (uint256 i = 0; i < ids.length; i++) {
            delete _wrappedKeys[ids[i]][provider];
        }
        emit AccessRevoked(msg.sender, provider);
    }

    function hasAccess(address patient, address provider) public view returns (bool) {
        return _providers[provider].active && accessExpiry[patient][provider] > block.timestamp;
    }

    // ------------------------------------------------------------------ records

    /// Add an encrypted record. `readers` must include the patient, and every reader must be
    /// the patient or a provider with current access. The author is the patient themself
    /// (self-reported data) or a provider with access.
    function addRecord(
        address patient,
        string calldata category,
        bytes calldata ciphertext,
        uint256 supersedes,
        address[] calldata readers,
        bytes[] calldata wrappedKeys
    ) external returns (uint256 id) {
        if (!isPatient[patient]) revert NotPatient();
        if (msg.sender != patient && !hasAccess(patient, msg.sender)) revert NoAccess();
        if (ciphertext.length == 0 || readers.length != wrappedKeys.length) revert InvalidInput();
        if (supersedes != 0 && _record(supersedes).patient != patient) revert InvalidInput();

        id = _records.length + 1;
        bytes32 hash = keccak256(ciphertext);
        _records.push(
            Record({
                id: uint64(id),
                timestamp: uint64(block.timestamp),
                supersedes: uint64(supersedes),
                redacted: false,
                patient: patient,
                author: msg.sender,
                contentHash: hash,
                category: category
            })
        );
        _patientRecords[patient].push(id);
        emit RecordAdded(id, patient, msg.sender, category, hash, supersedes, ciphertext);

        bool patientIncluded;
        for (uint256 i = 0; i < readers.length; i++) {
            address reader = readers[i];
            if (reader == patient) patientIncluded = true;
            else if (!hasAccess(patient, reader)) revert NoAccess();
            _shareKey(id, reader, wrappedKeys[i]);
        }
        if (!patientIncluded) revert InvalidInput();
    }

    /// Hide a record from default views. The ciphertext stays on-chain (the ledger is
    /// append-only), so this is a visible, auditable redaction rather than a deletion.
    function redactRecord(uint256 id) external {
        Record storage r = _record(id);
        if (r.patient != msg.sender) revert NoAccess();
        r.redacted = true;
        emit RecordRedacted(id, msg.sender);
    }

    // ------------------------------------------------------------------ views

    function recordCount() external view returns (uint256) {
        return _records.length;
    }

    function getRecord(uint256 id) external view returns (Record memory) {
        Record storage r = _record(id);
        if (!_canRead(r, msg.sender)) revert NoAccess();
        return r;
    }

    function getPatientRecords(address patient) external view returns (Record[] memory out) {
        if (msg.sender != patient && !hasAccess(patient, msg.sender)) revert NoAccess();
        uint256[] storage ids = _patientRecords[patient];
        out = new Record[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) out[i] = _records[ids[i] - 1];
    }

    /// The caller's wrapped key for a record (empty if none or access has lapsed).
    function myWrappedKey(uint256 id) external view returns (bytes memory) {
        Record storage r = _record(id);
        if (!_canRead(r, msg.sender)) return "";
        return _wrappedKeys[id][msg.sender];
    }

    function getProvider(address provider) external view returns (Provider memory) {
        return _providers[provider];
    }

    function getProviders() external view returns (address[] memory) {
        return _providerList;
    }

    function getGrantees(address patient) external view returns (address[] memory) {
        return _grantees[patient];
    }

    function roleOf(address account) external view returns (string memory) {
        if (account == admin) return "admin";
        if (_providers[account].active) return "provider";
        if (isPatient[account]) return "patient";
        return "none";
    }

    // ------------------------------------------------------------------ internal

    function _record(uint256 id) private view returns (Record storage) {
        if (id == 0 || id > _records.length) revert UnknownRecord(id);
        return _records[id - 1];
    }

    function _canRead(Record storage r, address reader) private view returns (bool) {
        return reader == r.patient || hasAccess(r.patient, reader);
    }

    function _shareKey(uint256 id, address reader, bytes calldata wrapped) private {
        if (encryptionKey[reader] == bytes32(0)) revert MissingEncryptionKey(reader);
        if (wrapped.length == 0) revert InvalidInput();
        _wrappedKeys[id][reader] = wrapped;
        emit KeyShared(id, reader);
    }
}
