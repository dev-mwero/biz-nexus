import type { Types } from "mongoose";
import { connectToDatabase } from "@/db/connection";
import { NotificationModel } from "@/modules/notifications";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";

/**
 * GET /api/v1/notifications/stream
 *
 * Server-Sent Events endpoint for real-time notification updates.
 * Sends the unread count initially, then streams updates as they happen.
 *
 * The client should reconnect on disconnect with exponential backoff.
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("notifications.read");

  await connectToDatabase();

  const organizationId = context.organization._id;
  const userId = context.user._id;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial unread count
      const initialCount = await NotificationModel.countDocuments({
        organizationId,
        userId,
        readAt: null,
      });

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "unread-count", count: initialCount })}\n\n`,
        ),
      );

      // Set up a change stream to watch for new notifications
      const changeStream = NotificationModel.watch(
        [
          {
            $match: {
              "fullDocument.organizationId": organizationId,
              "fullDocument.userId": userId,
              operationType: { $in: ["insert", "update"] },
            },
          },
        ],
        { fullDocument: "updateLookup" },
      );

      changeStream.on("change", async (change) => {
        try {
          if (change.operationType === "insert") {
            const count = await NotificationModel.countDocuments({
              organizationId,
              userId,
              readAt: null,
            });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "unread-count", count })}\n\n`,
              ),
            );
          } else if (change.operationType === "update") {
            // Check if readAt was set (notification marked as read)
            const fullDoc = change.fullDocument;
            if (fullDoc && fullDoc.readAt) {
              const count = await NotificationModel.countDocuments({
                organizationId,
                userId,
                readAt: null,
              });
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "unread-count", count })}\n\n`,
                ),
              );
            }
          }
        } catch {
          // Ignore errors during streaming
        }
      });

      // Send a heartbeat every 30 seconds to keep the connection alive
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 30_000);

      // Clean up on close
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        changeStream.close();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
});
