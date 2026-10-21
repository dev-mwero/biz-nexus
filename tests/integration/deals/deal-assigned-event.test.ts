import {
  connectToDatabase,
  disconnectDatabase,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { DealModel } from "@/modules/deals/deal.model";
import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineModel } from "@/modules/pipelines";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { recordEvents } from "@/shared/events/bus";

/**
 * `deal.assigned`, from the side that emits it.
 *
 * The subscriber that turns this into a notification is tested separately and
 * against a hand-written event. This file is about the producer: that creating
 * and re-assigning a deal put the event on the bus, and that an edit which does
 * not touch the owner stays quiet. The two halves meet at the payload's shape,
 * which is declared once in `deal.events.ts` and compiled against by both.
 */

const org = new Types.ObjectId();
const actor = new Types.ObjectId();
const other = new Types.ObjectId();

const cleanups: Array<() => void> = [];

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await DealModel.deleteMany({});
  await PipelineModel.deleteMany({});
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

async function stageInPipeline() {
  const pipeline = await PipelineModel.create({
    organizationId: org,
    name: "Sales",
    isDefault: true,
    order: 0,
    stages: [],
    createdBy: actor,
    updatedBy: actor,
  });
  const stageId = new Types.ObjectId();
  await PipelineModel.findByIdAndUpdate(pipeline._id, {
    stages: [
      {
        _id: stageId,
        key: "NEW",
        name: "New",
        order: 0,
        probability: 0,
        color: "blue",
        isWon: false,
        isLost: false,
      },
    ],
  });
  return { pipelineId: pipeline._id, stageId };
}

function service() {
  return new DealService(
    new DealRepository(org, actor),
    new PipelineRepository(org, actor),
    actor,
  );
}

describe("DealService.create emits deal.assigned", () => {
  it("names the created deal's owner and the actor who created it", async () => {
    const recorder = recordEvents("deal.assigned");
    cleanups.push(recorder.stop);
    const { pipelineId, stageId } = await stageInPipeline();

    const deal = await service().create({
      name: "Big Deal",
      pipelineId,
      stageId,
      ownerId: other,
    });

    const events = recorder.payloads();
    expect(events).toHaveLength(1);
    expect(events[0].dealId.toString()).toBe(deal._id.toString());
    expect(events[0].dealName).toBe("Big Deal");
    expect(events[0].ownerId.toString()).toBe(other.toString());
    expect(events[0].assignedBy.toString()).toBe(actor.toString());
    expect(events[0].organizationId.toString()).toBe(org.toString());
  });

  it("emits even when the creator owns the deal", async () => {
    // The emitter does not second-guess: a deal always has an owner, so creating
    // one is always an assignment. The subscriber decides that a self-assignment
    // is not worth a notification. Keeping that call in one place is why a
    // future channel -- email, digest -- sees the same event stream.
    const recorder = recordEvents("deal.assigned");
    cleanups.push(recorder.stop);
    const { pipelineId, stageId } = await stageInPipeline();

    await service().create({
      name: "Mine",
      pipelineId,
      stageId,
      ownerId: actor,
    });

    const events = recorder.payloads();
    expect(events).toHaveLength(1);
    expect(events[0].ownerId.toString()).toBe(actor.toString());
    expect(events[0].assignedBy.toString()).toBe(actor.toString());
  });
});

describe("DealService.update emits deal.assigned only on a change of owner", () => {
  async function existingDeal(ownerId: Types.ObjectId) {
    const { pipelineId, stageId } = await stageInPipeline();
    return DealModel.create({
      organizationId: org,
      name: "Big Deal",
      companyId: null,
      contactId: null,
      pipelineId,
      stageId,
      ownerId,
      value: 1000,
      currency: "USD",
      probability: 50,
      status: "OPEN",
      expectedCloseDate: null,
      closedAt: null,
      lostReason: null,
      description: null,
      sortOrder: 0,
      tags: [],
      customFields: {},
      createdBy: actor,
      updatedBy: actor,
    });
  }

  it("emits when the owner changes, naming the new owner", async () => {
    const deal = await existingDeal(actor);
    const recorder = recordEvents("deal.assigned");
    cleanups.push(recorder.stop);

    await service().update(deal._id, { ownerId: other.toString() });

    const events = recorder.payloads();
    expect(events).toHaveLength(1);
    expect(events[0].dealId.toString()).toBe(deal._id.toString());
    expect(events[0].ownerId.toString()).toBe(other.toString());
    expect(events[0].assignedBy.toString()).toBe(actor.toString());
  });

  it("stays quiet when the owner is set to the person it already is", async () => {
    // The incoming id is a string and the stored one an ObjectId; a comparison
    // by identity would treat this as a change and ring a bell about an edit
    // that changed nothing.
    const deal = await existingDeal(actor);
    const recorder = recordEvents("deal.assigned");
    cleanups.push(recorder.stop);

    await service().update(deal._id, { ownerId: actor.toString() });

    expect(recorder.payloads()).toHaveLength(0);
  });

  it("stays quiet for an edit that does not mention the owner", async () => {
    const deal = await existingDeal(actor);
    const recorder = recordEvents("deal.assigned");
    cleanups.push(recorder.stop);

    await service().update(deal._id, { name: "Renamed" });

    expect(recorder.payloads()).toHaveLength(0);
  });

  it("stays quiet when the deal is not this organization's", async () => {
    // A cross-tenant id resolves to null and the update reports the miss the
    // way it always has. Nothing is emitted, because nothing was assigned.
    const recorder = recordEvents("deal.assigned");
    cleanups.push(recorder.stop);

    const result = await service().update(new Types.ObjectId(), {
      ownerId: other.toString(),
    });

    expect(result).toBeNull();
    expect(recorder.payloads()).toHaveLength(0);
  });
});
