import {
  Experimental,
  Field,
  Struct,
  SelfProof,
  MerkleMapWitness,
  Provable,
} from 'o1js';
import { UserCircuit, UserState } from './UserCircuit';
import { EncryptionPublicKey } from '../utils/PallierZK';

export class AggregatorState extends Struct({
  encryptionPublicKey: EncryptionPublicKey,
  electionID: Field,
  voterRoot: Field,
  oldNullifierRoot: Field,
  newNullifierRoot: Field,
  nonce: Field,
  oldVoteCount: Provable.Array(Field, 2),
  newVoteCount: Provable.Array(Field, 2),
}) {
  static create(
    encryptionPublicKey: EncryptionPublicKey,
    electionID: Field,
    voterRoot: Field,
    oldNullifierRoot: Field,
    newNullifierRoot: Field,
    nonce: Field,
    oldVoteCount: Field[],
    newVoteCount: Field[]
  ) {
    return new AggregatorState({
      encryptionPublicKey,
      electionID,
      voterRoot,
      oldNullifierRoot,
      newNullifierRoot,
      nonce,
      oldVoteCount,
      newVoteCount,
    });
  }
}

export const AggregatorCircuit = Experimental.ZkProgram({
  publicInput: AggregatorState,

  methods: {
    generateBaseProof: {
      privateInputs: [],

      method(aggregatorstate: AggregatorState) {
        aggregatorstate.encryptionPublicKey.n.isConstant();
        aggregatorstate.encryptionPublicKey.g.isConstant();
        aggregatorstate.electionID.isConstant();
        aggregatorstate.voterRoot.isConstant();
        aggregatorstate.oldNullifierRoot.isConstant();
        aggregatorstate.newNullifierRoot.isConstant();
        aggregatorstate.nonce.isConstant();

        aggregatorstate.oldNullifierRoot.assertEquals(
          aggregatorstate.newNullifierRoot
        );

        aggregatorstate.nonce.assertEquals(Field(0));

        for (let i = 0; i < 2; i++) {
          aggregatorstate.oldVoteCount[i].isConstant();
          aggregatorstate.newVoteCount[i].isConstant();
          aggregatorstate.oldVoteCount[i].assertEquals(
            aggregatorstate.newVoteCount[i]
          );
        }
      },
    },

    generateProof: {
      privateInputs: [
        SelfProof,
        Experimental.ZkProgram.Proof(UserCircuit),
        // MerkleMapWitness,
      ],

      method(
        aggregatorState: AggregatorState,
        earlierProof: SelfProof<AggregatorState, void>,
        userProof: SelfProof<UserState, void>
        // nullifierWitness: MerkleMapWitness
      ) {
        // Verify the User Proof
        userProof.verify();

        // Verify the Aggregator Proof
        earlierProof.verify();

        // Verify if the Encryption Public Key matches
        userProof.publicInput.encryptionPublicKey.n.assertEquals(
          aggregatorState.encryptionPublicKey.n
        );
        userProof.publicInput.encryptionPublicKey.g.assertEquals(
          aggregatorState.encryptionPublicKey.g
        );

        // Verify if the election ID matches
        userProof.publicInput.electionID.assertEquals(
          aggregatorState.electionID
        );

        // Verify if the Voter Root matches
        userProof.publicInput.voterRoot.assertEquals(aggregatorState.voterRoot);

        // // verify correct message was included in nullifier
        // userProof.publicInput.nullifier.verify([
        //   userProof.publicInput.userPublicKey.x,
        //   userProof.publicInput.electionID,
        // ]);

        // // Add the Nullifier to the oldNullifierRoot
        // userProof.publicInput.nullifier.assertUnused(
        //   nullifierWitness,
        //   aggregatorState.oldNullifierRoot
        // );
        // let newRoot = userProof.publicInput.nullifier.setUsed(nullifierWitness);
        // aggregatorState.newNullifierRoot.assertEquals(newRoot);

        // Verify if the Nonce is correct
        earlierProof.publicInput.nonce.assertEquals(
          aggregatorState.nonce.sub(Field(1))
        );

        // Verify if the vote count is correct from the earlier proof
        for (let i = 0; i < 2; i++) {
          aggregatorState.oldVoteCount[i].assertEquals(
            earlierProof.publicInput.newVoteCount[i]
          );
        }

        // Verify if the new vote count is correct
        const newVoteCount = [];
        for (let i = 0; i < 2; i++) {
          const newCount = aggregatorState.encryptionPublicKey.add(
            aggregatorState.oldVoteCount[i],
            userProof.publicInput.encrypted_vote[i]
          );

          aggregatorState.newVoteCount[i].assertEquals(newCount);
          newVoteCount.push(newCount);
        }
      },
    },
  },
});
