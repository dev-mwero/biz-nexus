import net from "node:net";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectionOptions } from "@/db/connection";

/**
 * Pins the behaviour that justifies `bufferCommands: false`, measured rather
 * than assumed.
 *
 * The window this needs is narrow and easy to miss: buffering only happens
 * while the connection is mid-handshake, so a server that refuses the socket
 * instantly is useless here. The test accepts the TCP connection and then says
 * nothing, which is what a wedged Atlas primary looks like from the driver's
 * side.
 *
 * A budget rather than a threshold on a clock. The point is not that one number
 * is fast; it is that the caller is told immediately rather than after a wait
 * long enough to collide with the platform's own timeout.
 */

let server: net.Server;
const sockets: net.Socket[] = [];
let port: number;

beforeAll(async () => {
  server = net.createServer((socket) => {
    // Accept and stall. No handshake, no reply, no close.
    socket.on("error", () => {});
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("bufferCommands: false", () => {
  it("is off, which is the deviation from the Mongoose default", () => {
    expect(new mongoose.Schema({}).options.bufferCommands).toBe(true);
    expect(connectionOptions.bufferCommands).toBe(false);
  });

  it("fails a query immediately while the connection is stalled", async () => {
    const Model =
      mongoose.models.buffering_probe ??
      mongoose.model("buffering_probe", new mongoose.Schema({ name: String }));

    const connection = mongoose
      .connect(`mongodb://127.0.0.1:${port}/stalled`, {
        ...connectionOptions,
        serverSelectionTimeoutMS: 4_000,
      })
      .catch(() => {});

    // Let the driver reach the connecting state. Without this the query sees a
    // closed connection instead of a stalled one and the test proves nothing.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mongoose.connection.readyState).toBe(2);

    const started = Date.now();
    await expect(Model.findOne({ name: "x" })).rejects.toThrow();
    const elapsed = Date.now() - started;

    // Mongoose's default would spend ~10s in bufferTimeoutMS here.
    expect(elapsed).toBeLessThan(1_000);

    await connection;
    await mongoose.disconnect();
  }, 20_000);
});
