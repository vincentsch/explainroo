// Errors the command line prints as a plain message, without a stack. This file
// imports nothing, so that connectors and project.js can both use it.
export class ProjectError extends Error {}

// A paid request that ended without a result. The outcome goes in the record:
//   refused  the service said no, or nothing was sent, so it cost nothing
//   failed   the service answered with an error, and it may have cost money
//   lost     no answer came back, so nobody can tell what it cost
// A read that costs nothing, such as a video job's status, has two more:
//   later    the service didn't answer this time, and trying again is free
//   gone     the service no longer has it
export class ServiceError extends ProjectError {
  constructor(message, outcome, details = {}) {
    super(message);
    this.outcome = outcome;
    this.details = details;
  }
}

const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']);

// What a request that threw can have cost. These errors mean it never reached
// the service. Anything else may have been charged.
export function thrownOutcome(error) {
  return NOT_SENT.has(error?.cause?.code) ? 'refused' : 'lost';
}

const secrets = new Set();

// Every key this process reads is listed here, so that no message can show one.
export function rememberSecret(value) {
  if (value) secrets.add(value);
  return value;
}

export function hideSecrets(text) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join('[key hidden]');
  return out;
}
