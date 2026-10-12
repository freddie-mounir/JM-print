import { handleApiRequest } from "../lib/quote-api.ts";

export function POST(request: Request): Promise<Response> {
    return handleApiRequest("quote", request);
}
