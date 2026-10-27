export class WorkspaceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
    this.code = code;
  }
}

export function invalid(message = 'The request is invalid.') {
  return new WorkspaceError(400, 'invalid_request', message);
}

export function unavailable() {
  return new WorkspaceError(503, 'storage_unavailable', 'Durable workspace storage is unavailable. Configure the database and run the explicit schema setup.');
}
