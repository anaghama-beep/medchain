// Deploys MedChain, writes the address and ABI for the frontend, and (with SEED=1)
// fills the chain with synthetic demo data. All names and medical details are fictional.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const DAY = 24 * 3600;
const OUT = path.join(__dirname, "..", "frontend", "src", "contracts", "MedChain.json");

async function main() {
  const { ethers, network } = hre;
  const medchain = await ethers.deployContract("MedChain");
  await medchain.waitForDeployment();
  const address = await medchain.getAddress();
  const deployBlock = (await medchain.deploymentTransaction().wait()).blockNumber;
  const { chainId } = await ethers.provider.getNetwork();

  const artifact = await hre.artifacts.readArtifact("MedChain");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ address, chainId: Number(chainId), deployBlock, abi: artifact.abi }, null, 2) + "\n",
  );
  console.log(`MedChain deployed to ${address} on ${network.name} (chain ${chainId})`);

  if (process.env.SEED === "1") await seed(medchain);
}

async function seed(medchain) {
  const { ethers, network } = hre;
  const crypto = await import("../frontend/src/lib/crypto.mjs");
  const [admin, meera, arjun, aanya, rohan] = await ethers.getSigners();
  const keys = new Map();
  for (const s of [meera, arjun, aanya, rohan]) keys.set(s.address, await crypto.deriveKeyPair(s));
  const pub = (s) => crypto.publicKeyHex(keys.get(s.address).publicKey);

  const advance = async (days) => {
    await network.provider.send("evm_increaseTime", [Math.round(days * DAY)]);
    await network.provider.send("evm_mine");
  };
  const now = async () => (await ethers.provider.getBlock("latest")).timestamp;

  async function addRecord(author, patient, category, data, readers, supersedes = 0) {
    const { ciphertext, recordKey } = crypto.encryptRecord(data);
    const wrapped = readers.map((r) => crypto.wrapKey(recordKey, pub(r)));
    const tx = await medchain
      .connect(author)
      .addRecord(patient, category, ciphertext, supersedes, readers.map((r) => r.address), wrapped);
    await tx.wait();
    return Number(await medchain.recordCount());
  }

  async function grant(patient, provider, days) {
    const ids = [];
    const wrapped = [];
    for (const r of await medchain.connect(patient).getPatientRecords(patient)) {
      const key = await medchain.connect(patient).myWrappedKey(r.id);
      if (key === "0x") continue;
      ids.push(r.id);
      wrapped.push(crypto.wrapKey(crypto.unwrapKey(key, keys.get(patient.address).secretKey), pub(provider)));
    }
    await (await medchain.connect(patient).grantAccess(provider, (await now()) + days * DAY, ids, wrapped)).wait();
  }

  await medchain.connect(admin).registerProvider(meera, "Dr. Meera Rao", "City General Hospital");
  await medchain.connect(admin).registerProvider(arjun, "Dr. Arjun Patel", "Sunrise Family Clinic");
  await medchain.connect(meera).setEncryptionKey(pub(meera));
  await medchain.connect(arjun).setEncryptionKey(pub(arjun));
  await medchain.connect(aanya).registerPatient(pub(aanya));
  await medchain.connect(rohan).registerPatient(pub(rohan));

  const aanyaInfo = { patientName: "Aanya Sharma", age: 29, gender: "Female", bloodType: "B+" };
  const rohanInfo = { patientName: "Rohan Iyer", age: 46, gender: "Male", bloodType: "O-" };

  await advance(2);
  await addRecord(aanya, aanya, "Allergies", {
    ...aanyaInfo,
    title: "Known allergies",
    allergies: "Pollen, penicillin",
    notes: "Self-reported. Penicillin reaction (rash) in 2019.",
  }, [aanya]);

  await advance(5);
  await grant(aanya, arjun, 180);
  await advance(1);
  await addRecord(arjun, aanya, "Consultation", {
    ...aanyaInfo,
    title: "General check-up",
    allergies: "Pollen, penicillin",
    diagnosis: "Seasonal allergic rhinitis",
    treatment: "Cetirizine 10 mg once daily during spring",
    notes: "BP 112/74, pulse 70. Advised follow-up if symptoms persist.",
  }, [aanya, arjun]);

  await advance(20);
  await grant(aanya, meera, 365);
  await advance(3);
  const labs = await addRecord(meera, aanya, "Lab results", {
    ...aanyaInfo,
    title: "Complete blood count",
    diagnosis: "Mild iron-deficiency anaemia",
    treatment: "Ferrous sulphate 200 mg daily for 3 months",
    notes: "Haemoglobin 10.9 g/dL (ref 12.0-15.5). Ferritin 9 ng/mL.",
  }, [aanya, meera]);

  await advance(45);
  await addRecord(meera, aanya, "Lab results", {
    ...aanyaInfo,
    title: "Complete blood count (follow-up)",
    diagnosis: "Anaemia resolving",
    treatment: "Continue ferrous sulphate for 1 more month",
    notes: "Haemoglobin 12.4 g/dL. Ferritin 28 ng/mL.",
  }, [aanya, meera], labs);

  await advance(10);
  await (await medchain.connect(aanya).revokeAccess(arjun)).wait();

  await advance(4);
  await grant(rohan, meera, 90);
  await advance(1);
  await addRecord(meera, rohan, "Consultation", {
    ...rohanInfo,
    title: "Cardiology consultation",
    allergies: "None known",
    diagnosis: "Stage 1 hypertension",
    treatment: "Amlodipine 5 mg daily; reduce sodium intake",
    notes: "BP 142/91 averaged over three readings. ECG normal sinus rhythm.",
  }, [rohan, meera]);
  await advance(14);
  await addRecord(rohan, rohan, "Vitals", {
    ...rohanInfo,
    title: "Home blood pressure log",
    notes: "Two-week average 131/84 after starting medication.",
  }, [rohan, meera]);

  // Bring the chain clock back in line with real time.
  const target = Math.floor(Date.now() / 1000);
  if (target > (await now())) {
    await network.provider.send("evm_setNextBlockTimestamp", [target]);
    await network.provider.send("evm_mine");
  }
  console.log(`Seeded ${await medchain.recordCount()} encrypted records for 2 patients and 2 providers`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
