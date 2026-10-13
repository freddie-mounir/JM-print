import { handleApiRequest } from "../lib/quote-api.js";

export function GET(request: Request): Promise<Response> {
    return handleApiRequest("requests", request);
}

export function PATCH(request: Request): Promise<Response> {
    return handleApiRequest("requests", request);
}

export function DELETE(request: Request): Promise<Response> {
    return handleApiRequest("requests", request);
}
