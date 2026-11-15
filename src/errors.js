export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
/** Thrown by repositories when a unique constraint (email) is violated. */
export class DuplicateError extends Error {}
