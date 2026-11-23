export const GHL_SIGNATURE_HEADER = "x-ghl-signature";

export const GHL_SERVICES_URL = "https://services.leadconnectorhq.com";

export const GHL_API_VERSION = "2021-07-28";

export const GHL_INSTALLED_LOCATIONS_PAGE_SIZE = 100;

export const GREEN_API_WEBHOOK_MAX_ATTEMPTS = 5;

export const MAX_PHONE_DIGITS = 15;

export const GROUP_ID_TAG_PREFIX = "whatsapp-group-id-";

export const CALLS_PHONE_PATH = "/calls-phone";

export const CALLS_PHONE_CLIENT_PREFIX = "/app/calls-phone/";

export const CALLS_PHONE_TICKET_TTL_MS = 8 * 60 * 60 * 1000;

export const CALLS_AVAILABILITY_TTL_MS = 10 * 60 * 1000;

export const CALLS_AVAILABILITY_PROBE_TIMEOUT_MS = 5000;

export const CALLS_REFUSAL_ERROR_CODES: readonly string[] = ["NOT_IN_TARIFF", "CALLS_NOT_ENABLED"];

export const CALL_END_STATUSES: readonly string[] = ["hangUp", "hungUp", "missed", "declined", "invalid"];

export const CALL_RECORDING_POLL_INTERVAL_MS = 5000;

export const CALL_RECORDING_POLL_ATTEMPTS = 12;

export const CALL_RECORDING_MESSAGE = "🎙️ Call recording";

export const CALL_RECORDINGS_PATH = "call-recordings";

export const CALL_RECORDING_FILE_EXTENSION = ".ogg";

export const CALL_RECORDING_SIGNATURE_PARAM = "s";

export const CALL_RECORDING_LINK_KEY_LABEL = "green-api-call-recording-links";

export const CALL_RECORDING_REDIRECT_CACHE_MS = 45 * 60 * 1000;

export const GHL_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const PRISMA_TRANSIENT_ERROR_CODES = ["P1001", "P1002", "P1008", "P1017", "P2024"];

export const GHL_WEBHOOK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;
