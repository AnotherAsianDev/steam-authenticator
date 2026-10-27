/** An error whose message is safe and useful to show the user as-is. Anything else becomes a generic message. */
export class UserError extends Error {}

/** Steam could not be reached. Not the user's fault, and never a reason to blame a saved password. */
export class NetworkError extends UserError {}
