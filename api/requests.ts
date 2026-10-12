import { handleApiRequest } from "../lib/quote-api.js";

export function GET(request: Request): Promise<Response> {
    return handleApiRequest("requests", request);
}
