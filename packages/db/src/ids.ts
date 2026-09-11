import { uuidv7 } from 'uuidv7';

/** Generate a UUIDv7 primary key (preferred per frozen tech decisions). */
export function newId(): string {
  return uuidv7();
}
