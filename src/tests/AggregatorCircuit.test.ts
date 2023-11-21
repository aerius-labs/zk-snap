import {
  AccountUpdate,
  Cache,
  Field,
  MerkleMap,
  MerkleTree,
  Mina,
  Nullifier,
  Poseidon,
  PrivateKey,
  Proof,
  PublicKey,
  Signature,
  verify,
} from 'o1js';
import {
  MyMerkleWitness,
  UserCircuit,
  UserState,
} from '../circuits/UserCircuit';
import {
  AggregatorCircuit,
  AggregatorState,
} from '../circuits/AggregatorCircuit';
import { Aggregator } from '../circuits/Aggregator';
import * as paillierBigint from 'paillier-bigint';
import { generateEncryptionKeyPair } from '../utils/Pallier';
import { EncryptionPublicKey } from '../utils/PallierZK';

describe('Aggregator Circuit Test', () => {
  let senderKey: PrivateKey;
  let sender: PublicKey;

  let zkAppKey: PrivateKey;
  let zkAppAddress: PublicKey;

  let aggregatorContract: Aggregator;

  let userCircuitVK: string;
  let aggregatorCircuitVK: string;
  let aggregatorVK: any;

  let encryptionPrivateKey: paillierBigint.PrivateKey;
  let encryptionPublicKey: paillierBigint.PublicKey;

  let userPrivateKey: PrivateKey;
  let userPublicKey: PublicKey;

  let electionID = Field(1);
  let nonce = Field(0);

  let nullifierTree: MerkleMap;
  let oldNullifierRoot: Field;
  let newNullifierRoot: Field;

  let voterTree: MerkleTree;
  let voterRoot: Field;

  let initVoteCount: Field;
  let userEncryptedVote: Field;

  let userProof: Proof<UserState, void>;

  let aggregatorBaseProof: Proof<AggregatorState, void>;
  let aggregatorProof: Proof<AggregatorState, void>;
  let aggregatorState: AggregatorState;

  beforeAll(async () => {
    zkAppKey = PrivateKey.random();
    zkAppAddress = PublicKey.fromPrivateKey(zkAppKey);

    const { publicKey: encPublicKey, privateKey: encPrivateKey } =
      await generateEncryptionKeyPair();
    encryptionPrivateKey = encPrivateKey;
    encryptionPublicKey = encPublicKey;

    userPrivateKey = PrivateKey.random();
    userPublicKey = PublicKey.fromPrivateKey(userPrivateKey);

    voterTree = new MerkleTree(8);

    nullifierTree = new MerkleMap();
    oldNullifierRoot = nullifierTree.getRoot();
    newNullifierRoot = oldNullifierRoot;

    initVoteCount = Field(
      encryptionPublicKey.encrypt(
        Field(4252463546767452523n).toBigInt(),
        Field(425345223252).toBigInt()
      )
    );

    const cache = Cache.FileSystem(
      '/Users/shreyaslondhe/Desktop/dev/aerius-repos/zk-snap/keys'
    );

    const { verificationKey: vk1 } = await UserCircuit.compile({ cache });
    userCircuitVK = vk1;
    const { verificationKey: vk2 } = await AggregatorCircuit.compile({ cache });
    aggregatorCircuitVK = vk2;
    const { verificationKey: vk3 } = await Aggregator.compile({ cache });
    aggregatorVK = vk3;

    let Local = Mina.LocalBlockchain({ proofsEnabled: true });
    Mina.setActiveInstance(Local);

    const { privateKey: senderPrivateKey, publicKey: senderPublicKey } =
      Local.testAccounts[0];
    senderKey = senderPrivateKey;
    sender = senderPublicKey;
  });

  it('should generate an User Proof', async () => {
    const userSignature: Signature = Signature.create(userPrivateKey, [
      userPublicKey.x,
      electionID,
    ]);

    const vote: Field = Field(1);
    const voteWeight: Field = Field(50);

    const r_encryption: Field = Field(6942);
    userEncryptedVote = Field(
      encryptionPublicKey.encrypt(
        vote.toBigInt() * voteWeight.toBigInt(),
        r_encryption.toBigInt()
      )
    );

    const userBalance: Field = Field(100);

    const jsonNullifier = Nullifier.createTestNullifier(
      [userPublicKey.x, electionID],
      userPrivateKey
    );
    const nullifier = Nullifier.fromJSON(jsonNullifier);

    newNullifierRoot = nullifier.setUsed(
      nullifierTree.getWitness(nullifier.key())
    );

    voterTree.setLeaf(0n, Poseidon.hash([userPublicKey.x, userBalance]));
    voterTree.setLeaf(1n, Field.random());
    voterTree.setLeaf(2n, Field.random());
    voterTree.setLeaf(3n, Field.random());

    voterRoot = voterTree.getRoot();

    const merkleWitness = voterTree.getWitness(0n);
    const merkleProof = new MyMerkleWitness(merkleWitness);

    const userState = UserState.create(
      nullifier,
      EncryptionPublicKey.create(
        Field(encryptionPublicKey.n),
        Field(encryptionPublicKey.g),
        Field(encryptionPublicKey._n2)
      ),
      voterRoot,
      userPublicKey,
      electionID,
      userEncryptedVote
    );

    let time = Date.now();
    userProof = await UserCircuit.generateProof(
      userState,
      userSignature,
      vote,
      voteWeight,
      r_encryption,
      userBalance,
      merkleProof
    );
    console.log('userCircuit proving -', (Date.now() - time) / 1000, 'sec');

    time = Date.now();
    const result = await verify(userProof, userCircuitVK);
    console.log('userCircuit verifying -', (Date.now() - time) / 1000, 'sec');
    expect(result).toBe(true);
  });

  it('should generate an Aggregator Base Proof', async () => {
    aggregatorState = AggregatorState.create(
      EncryptionPublicKey.create(
        Field(encryptionPublicKey.n),
        Field(encryptionPublicKey.g),
        Field(encryptionPublicKey._n2)
      ),
      electionID,
      voterRoot,
      oldNullifierRoot,
      oldNullifierRoot,
      nonce,
      initVoteCount,
      initVoteCount
    );

    let time = Date.now();
    aggregatorBaseProof = await AggregatorCircuit.generateBaseProof(
      aggregatorState
    );
    console.log(
      'aggregatorCircuit base proving -',
      (Date.now() - time) / 1000,
      'sec'
    );

    time = Date.now();
    const result = await verify(aggregatorBaseProof, aggregatorCircuitVK);
    console.log(
      'aggregatorCircuit base verifying -',
      (Date.now() - time) / 1000,
      'sec'
    );
    expect(result).toBe(true);

    nonce = nonce.add(Field(1));
  });

  it('should submit base proof to the contract', async () => {
    aggregatorContract = new Aggregator(zkAppAddress);

    let initialBalance = 10_000_000_000;

    let tx = await Mina.transaction(sender, () => {
      let senderUpdate = AccountUpdate.fundNewAccount(sender);
      senderUpdate.send({ to: zkAppAddress, amount: initialBalance });
      aggregatorContract.deploy({
        verificationKey: aggregatorVK,
        zkappKey: zkAppKey,
      });
    });
    await tx.prove();
    await tx.sign([senderKey]).send();

    tx = await Mina.transaction(sender, () => {
      aggregatorContract.initializeElection(aggregatorBaseProof);
    });
    await tx.prove();
    await tx.sign([senderKey]).send();

    expect(aggregatorContract.electionID.get()).toEqual(electionID);
    expect(aggregatorContract.voterRoot.get()).toEqual(voterRoot);
  });

  it('should generate an Aggregator Proof', async () => {
    const nullifierWitness = nullifierTree.getWitness(
      userProof.publicInput.nullifier.key()
    );

    const cipherTexts = [
      initVoteCount.toBigInt(),
      userEncryptedVote.toBigInt(),
    ];
    const newVoteCount = Field(encryptionPublicKey.addition(...cipherTexts));

    aggregatorState = AggregatorState.create(
      EncryptionPublicKey.create(
        Field(encryptionPublicKey.n),
        Field(encryptionPublicKey.g),
        Field(encryptionPublicKey._n2)
      ),
      electionID,
      voterRoot,
      oldNullifierRoot,
      newNullifierRoot,
      nonce,
      initVoteCount,
      newVoteCount
    );

    let time = Date.now();
    aggregatorProof = await AggregatorCircuit.generateProof(
      aggregatorState,
      aggregatorBaseProof,
      userProof,
      nullifierWitness
    );
    console.log(
      'aggregatorCircuit proving -',
      (Date.now() - time) / 1000,
      'sec'
    );

    time = Date.now();
    const result = await verify(aggregatorProof, aggregatorCircuitVK);
    console.log(
      'aggregatorCircuit verifying -',
      (Date.now() - time) / 1000,
      'sec'
    );
    expect(result).toBe(true);

    oldNullifierRoot = newNullifierRoot;
    nonce = nonce.add(Field(1));
  });

  it('should submit final aggregator proof', async () => {
    let tx = await Mina.transaction(sender, () => {
      aggregatorContract.finalizeElection(aggregatorProof);
    });
    await tx.prove();
    await tx.sign([senderKey]).send();
  });
});
