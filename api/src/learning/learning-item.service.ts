import { Inject, Injectable } from '@nestjs/common';
import {
  LEARNING_ITEM_REPOSITORY,
  type LearningItemRepository,
} from './learning-item.repository';
import type { StartLearningItemDto } from './learning-item.dto';
import {
  PROVIDER_BUDGET_REPOSITORY,
  type ProviderBudgetRepository,
} from './provider-budget.repository';
import { canonicalizeYoutubeUrl } from './youtube-url.policy';

@Injectable()
export class LearningItemService {
  constructor(
    @Inject(PROVIDER_BUDGET_REPOSITORY)
    private readonly budget: ProviderBudgetRepository,
    @Inject(LEARNING_ITEM_REPOSITORY)
    private readonly items: LearningItemRepository,
  ) {}

  async start(userId: number, input: StartLearningItemDto) {
    const video = canonicalizeYoutubeUrl(input.videoUrl);
    const reservation = await this.budget.reserve({
      userId,
      ...video,
      requestedAudioSeconds: input.requestedAudioSeconds,
    });
    let context;
    try {
      context = await this.items.ensureContext({
        userId,
        ...video,
        sourcePostId: null,
        courseStepId: null,
        provenance: { origin: 'direct_intake' },
      });
    } catch (error) {
      if (!reservation.subscriptionCreated) throw error;
      try {
        const released = await this.budget.releaseSubscription(
          userId,
          reservation.reservationId,
        );
        if (!released) throw new LearningIntakeCompensationError();
      } catch {
        throw new LearningIntakeCompensationError();
      }
      throw error;
    }
    return Object.freeze({
      reservationId: reservation.reservationId,
      workId: reservation.workId,
      admission: reservation.admission,
      reservedAudioSeconds: reservation.reservedAudioSeconds,
      context,
    });
  }
}

export class LearningIntakeCompensationError extends Error {
  readonly code = 'LEARNING_INTAKE_COMPENSATION_FAILED';

  constructor() {
    super('LEARNING_INTAKE_COMPENSATION_FAILED');
  }
}
