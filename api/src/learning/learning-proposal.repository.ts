import type {
  LearningProposal,
  ProposalApprovalTarget,
} from './learning.types';

export const LEARNING_PROPOSAL_REPOSITORY = Symbol(
  'LEARNING_PROPOSAL_REPOSITORY',
);

export interface LearningProposalRepository {
  createFromVerifiedRun(
    ownerId: number,
    runId: string,
  ): Promise<LearningProposal>;
  findOwnerProposal(
    ownerId: number,
    proposalId: string,
  ): Promise<LearningProposal | null>;
  dismiss(ownerId: number, proposalId: string): Promise<LearningProposal>;
  approve(
    ownerId: number,
    proposalId: string,
    target: ProposalApprovalTarget,
  ): Promise<LearningProposal>;
}
