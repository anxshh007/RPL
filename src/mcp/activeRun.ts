// OWNER: Member 1 — links tool calls that arrive over HTTP (made by the TrueForge server) to the
// RepoPilot request that is being planned right now. TrueForge's calls carry no request id, so
// exactly one request may plan at a time; with none planning, every tool call is refused.
import type { ToolCallContext } from './toolRegistry';
import { ValidationError } from '../agent/errors';

export type RunContext = Omit<ToolCallContext, 'origin'>;

export class ActiveRun {
  private current?: RunContext;

  /** Marks a request as planning. Returns the function that ends it (call it in `finally`). */
  begin(run: RunContext): () => void {
    if (this.current) {
      throw new ValidationError(
        `Request "${this.current.requestId}" is still planning; wait for it to finish or cancel it.`,
        'RUN_ALREADY_ACTIVE',
      );
    }
    this.current = run;
    return () => {
      if (this.current === run) {
        this.current = undefined;
      }
    };
  }

  /** Context for a tool call made by the model through TrueForge, or undefined when nothing is planning. */
  toolContext(): ToolCallContext | undefined {
    const run = this.current;
    if (!run || run.signal?.aborted) {
      return undefined;
    }
    return { ...run, origin: 'model' };
  }

  get requestId(): string | undefined {
    return this.current?.requestId;
  }
}
