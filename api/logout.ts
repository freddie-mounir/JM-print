import { handleApiRequest } from "../lib/quote-api.js";

export function POST(request: Request): Promise<Response> {
    return handleApiRequest("logout", request);
}
