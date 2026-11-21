const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const KEY = (n) => ethers.zeroPadValue(ethers.toBeHex(n), 32);
const BLOB = (s) => ethers.hexlify(ethers.toUtf8Bytes(s));
const DAY = 24 * 60 * 60;

async function deploy() {
  const [admin, doctor, nurse, patient, other] = await ethers.getSigners();
  const medchain = await ethers.deployContract("MedChain");
  await medchain.registerProvider(doctor, "Dr. Meera Rao", "City General Hospital");
  await medchain.connect(doctor).setEncryptionKey(KEY(2));
  await medchain.connect(patient).registerPatient(KEY(4));
  return { medchain, admin, doctor, nurse, patient, other };
}

async function withGrant() {
  const ctx = await deploy();
  const expiry = (await time.latest()) + 30 * DAY;
  await ctx.medchain.connect(ctx.patient).grantAccess(ctx.doctor, expiry, [], []);
  return { ...ctx, expiry };
}

async function selfRecord(medchain, patient, text = "self-reported") {
  await medchain.connect(patient).addRecord(patient, "Vitals", BLOB(text), 0, [patient], [BLOB("k-patient")]);
}

describe("MedChain", () => {
  describe("identity", () => {
    it("only the admin can register providers", async () => {
      const { medchain, nurse, other } = await loadFixture(deploy);
      await expect(medchain.connect(other).registerProvider(nurse, "N", "Org")).to.be.revertedWithCustomError(
        medchain,
        "NotAdmin",
      );
    });

    it("reports roles", async () => {
      const { medchain, admin, doctor, patient, other } = await loadFixture(deploy);
      expect(await medchain.roleOf(admin)).to.equal("admin");
      expect(await medchain.roleOf(doctor)).to.equal("provider");
      expect(await medchain.roleOf(patient)).to.equal("patient");
      expect(await medchain.roleOf(other)).to.equal("none");
    });

    it("rejects double registration and empty keys", async () => {
      const { medchain, patient, other } = await loadFixture(deploy);
      await expect(medchain.connect(patient).registerPatient(KEY(9))).to.be.revertedWithCustomError(
        medchain,
        "AlreadyRegistered",
      );
      await expect(medchain.connect(other).registerPatient(ethers.ZeroHash)).to.be.revertedWithCustomError(
        medchain,
        "InvalidInput",
      );
    });
  });

  describe("records", () => {
    it("lets a patient add a self-reported record and stores only the ciphertext hash", async () => {
      const { medchain, patient } = await loadFixture(deploy);
      const blob = BLOB("encrypted bytes");
      await expect(medchain.connect(patient).addRecord(patient, "Vitals", blob, 0, [patient], [BLOB("k")]))
        .to.emit(medchain, "RecordAdded")
        .withArgs(1, patient.address, patient.address, "Vitals", ethers.keccak256(blob), 0, blob);
      const r = await medchain.connect(patient).getRecord(1);
      expect(r.contentHash).to.equal(ethers.keccak256(blob));
      expect(await medchain.connect(patient).myWrappedKey(1)).to.equal(BLOB("k"));
    });

    it("blocks providers without consent", async () => {
      const { medchain, doctor, patient } = await loadFixture(deploy);
      await expect(
        medchain.connect(doctor).addRecord(patient, "Diagnosis", BLOB("x"), 0, [patient], [BLOB("k")]),
      ).to.be.revertedWithCustomError(medchain, "NoAccess");
    });

    it("lets a provider with consent add a record readable by both parties", async () => {
      const { medchain, doctor, patient } = await loadFixture(withGrant);
      await medchain
        .connect(doctor)
        .addRecord(patient, "Diagnosis", BLOB("x"), 0, [patient, doctor], [BLOB("kp"), BLOB("kd")]);
      const r = await medchain.connect(doctor).getRecord(1);
      expect(r.author).to.equal(doctor.address);
      expect(await medchain.connect(doctor).myWrappedKey(1)).to.equal(BLOB("kd"));
      expect(await medchain.connect(patient).myWrappedKey(1)).to.equal(BLOB("kp"));
    });

    it("requires the patient to be a reader and every reader to have access", async () => {
      const { medchain, doctor, patient, other } = await loadFixture(withGrant);
      await expect(
        medchain.connect(doctor).addRecord(patient, "Dx", BLOB("x"), 0, [doctor], [BLOB("k")]),
      ).to.be.revertedWithCustomError(medchain, "InvalidInput");
      await medchain.connect(other).setEncryptionKey(KEY(7));
      await expect(
        medchain.connect(doctor).addRecord(patient, "Dx", BLOB("x"), 0, [patient, other], [BLOB("a"), BLOB("b")]),
      ).to.be.revertedWithCustomError(medchain, "NoAccess");
    });

    it("hides records from unauthorised readers", async () => {
      const { medchain, patient, other } = await loadFixture(deploy);
      await selfRecord(medchain, patient);
      await expect(medchain.connect(other).getRecord(1)).to.be.revertedWithCustomError(medchain, "NoAccess");
      await expect(medchain.connect(other).getPatientRecords(patient)).to.be.revertedWithCustomError(
        medchain,
        "NoAccess",
      );
      expect(await medchain.connect(other).myWrappedKey(1)).to.equal("0x");
    });

    it("supports amendments that reference the original record", async () => {
      const { medchain, patient } = await loadFixture(deploy);
      await selfRecord(medchain, patient, "v1");
      await medchain.connect(patient).addRecord(patient, "Vitals", BLOB("v2"), 1, [patient], [BLOB("k")]);
      const records = await medchain.connect(patient).getPatientRecords(patient);
      expect(records.length).to.equal(2);
      expect(records[1].supersedes).to.equal(1);
    });

    it("lets only the patient redact, keeping the record on-chain", async () => {
      const { medchain, doctor, patient } = await loadFixture(withGrant);
      await selfRecord(medchain, patient);
      await expect(medchain.connect(doctor).redactRecord(1)).to.be.revertedWithCustomError(medchain, "NoAccess");
      await expect(medchain.connect(patient).redactRecord(1)).to.emit(medchain, "RecordRedacted").withArgs(1, patient);
      expect((await medchain.connect(patient).getRecord(1)).redacted).to.equal(true);
    });
  });

  describe("consent", () => {
    it("shares existing record keys when access is granted", async () => {
      const { medchain, doctor, patient } = await loadFixture(deploy);
      await selfRecord(medchain, patient);
      const expiry = (await time.latest()) + DAY;
      await expect(medchain.connect(patient).grantAccess(doctor, expiry, [1], [BLOB("for-doctor")]))
        .to.emit(medchain, "AccessGranted")
        .withArgs(patient, doctor, expiry);
      expect(await medchain.connect(doctor).myWrappedKey(1)).to.equal(BLOB("for-doctor"));
      expect(await medchain.getGrantees(patient)).to.deep.equal([doctor.address]);
    });

    it("cannot share keys for another patient's records", async () => {
      const { medchain, doctor, patient, other } = await loadFixture(deploy);
      await selfRecord(medchain, patient);
      await medchain.connect(other).registerPatient(KEY(8));
      const expiry = (await time.latest()) + DAY;
      await expect(
        medchain.connect(other).grantAccess(doctor, expiry, [1], [BLOB("x")]),
      ).to.be.revertedWithCustomError(medchain, "NoAccess");
    });

    it("only grants to active providers with a published key", async () => {
      const { medchain, admin, nurse, patient } = await loadFixture(deploy);
      const expiry = (await time.latest()) + DAY;
      await expect(medchain.connect(patient).grantAccess(nurse, expiry, [], [])).to.be.revertedWithCustomError(
        medchain,
        "NotActiveProvider",
      );
      await medchain.connect(admin).registerProvider(nurse, "Nurse Joy", "Clinic");
      await expect(medchain.connect(patient).grantAccess(nurse, expiry, [], []))
        .to.be.revertedWithCustomError(medchain, "MissingEncryptionKey")
        .withArgs(nurse.address);
    });

    it("expires access automatically", async () => {
      const { medchain, doctor, patient, expiry } = await loadFixture(withGrant);
      await selfRecord(medchain, patient);
      expect(await medchain.hasAccess(patient, doctor)).to.equal(true);
      await time.increaseTo(expiry + 1);
      expect(await medchain.hasAccess(patient, doctor)).to.equal(false);
      await expect(medchain.connect(doctor).getRecord(1)).to.be.revertedWithCustomError(medchain, "NoAccess");
    });

    it("revocation removes access and deletes the provider's keys", async () => {
      const { medchain, doctor, patient } = await loadFixture(deploy);
      await selfRecord(medchain, patient);
      const expiry = (await time.latest()) + DAY;
      await medchain.connect(patient).grantAccess(doctor, expiry, [1], [BLOB("kd")]);
      await expect(medchain.connect(patient).revokeAccess(doctor)).to.emit(medchain, "AccessRevoked");
      expect(await medchain.hasAccess(patient, doctor)).to.equal(false);
      expect(await medchain.getGrantees(patient)).to.deep.equal([]);
      // Even if access were re-granted without keys, the old wrapped key is gone.
      await medchain.connect(patient).grantAccess(doctor, expiry, [], []);
      expect(await medchain.connect(doctor).myWrappedKey(1)).to.equal("0x");
    });

    it("suspending a provider cuts off access immediately", async () => {
      const { medchain, admin, doctor, patient } = await loadFixture(withGrant);
      await medchain.connect(admin).setProviderActive(doctor, false);
      expect(await medchain.hasAccess(patient, doctor)).to.equal(false);
    });
  });
});
