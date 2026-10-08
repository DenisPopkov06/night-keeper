import { ObjectState } from "@/data/types";

type StateChangeListener = (instanceId: string, state: ObjectState) => void;

export class ObjectStateMachine {
  private readonly states = new Map<string, ObjectState>();
  private readonly listeners: StateChangeListener[] = [];

  setInitialState(instanceId: string, state: ObjectState): void {
    this.states.set(instanceId, state);
  }

  getState(instanceId: string): ObjectState {
    return this.states.get(instanceId) ?? ObjectState.NORMAL;
  }

  transition(instanceId: string, nextState: ObjectState): void {
    this.states.set(instanceId, nextState);
    for (const listener of this.listeners) listener(instanceId, nextState);
  }

  onChange(listener: StateChangeListener): void {
    this.listeners.push(listener);
  }

  reset(): void {
    this.states.clear();
  }
}
