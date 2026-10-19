# Security boundaries

- The API holds the OmniRoute key and forwards only supported, validated requests. It does not accept a client-supplied gateway base URL or arbitrary upstream path.
- Passwords use salted scrypt. Random session tokens are SHA-256 hashed in PostgreSQL. Browser tokens are HttpOnly cookies; native tokens are issued explicitly and stored with Expo SecureStore.
- Origin validation protects cookie-authenticated mutations; SameSite cookies supplement it. CORS allows exact configured origins. Native bearer requests are validated independently.
- Queries constrain user-owned conversations, folders, messages, files and jobs. Message parent IDs must belong to the conversation; a branch cannot read another conversation's content.
- Upload names are metadata only. On-disk storage uses server-generated IDs, byte-signature checks for supported media, size limits, and authenticated downloads. User-provided HTML is not rendered as raw markup.
- Chat generations are not automatically retried. Request UUID uniqueness prevents duplicate submission. Partial streamed output is persisted and marked incomplete if interrupted.
- Native renderer isolation, disabled Node integration, navigation restrictions, denied permissions, and IPC sender/payload validation limit desktop exposure.
- Provider errors should be sanitized; neither gateway keys nor upstream request headers may be returned in errors or logged.

## Operational scope

Coding projects enforce account ownership and bounded text snapshots. Model responses are validated proposals; applying files, executing commands, and publishing to a linked folder are separate actions. Revision and file-identity checks reject stale proposals, including deleted-and-recreated files. Local folder roots are assigned to account emails by the operator, and disk publication checks both the reviewed version and original content hashes. Linked publishing is not an atomic filesystem/database transaction; uncertain outcomes are reported explicitly. See [coding setup and limitations](CODING-WORKSPACE.md).

The optional Docker executor never launches a model-selected host shell. It uses an already-pulled operator-selected image, no network or host mounts, a non-root user, a read-only root, dropped capabilities and resource limits. Source is copied into a temporary workspace; command changes are discarded. The API's Docker access is privileged infrastructure and belongs on a trusted host. Container isolation does not replace host patching or an operational security review for public multi-tenant execution.

The initial API is a single-process deployment. A production public service needs a policy for who can register, password recovery/email delivery, deployment monitoring, backups, retention, upload extraction isolation, and distributed jobs before horizontal scaling. Native releases require signing and platform-specific testing. See deployment and platform documents for the concrete setup.

Automated tests use a fake gateway. Read-only discovery is optional. Paid provider traffic must never be triggered by test installation, application boot, or a background health check.
