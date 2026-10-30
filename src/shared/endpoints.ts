/**
 * Base contract for HTTP endpoints, so code can be reused and stay
 * maintainable as endpoints scale.
 *
 * Example: path `/v4/info`, method `GET`, returns `200 OK`.
 *
 * To add an endpoint, export an object of this shape from
 * `src/endpoints/` and register it in `EndpointsManager`.
 */
import type { Context } from './context'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Endpoint {
	path: string
	method: HttpMethod
	description: string
	handle(request: Request, context: Context): Response | Promise<Response>
}

export function routeParams(request: Request): Record<string, string> {
	return (request as unknown as { params?: Record<string, string> }).params ?? {}
}

export function httpError(status: number, error: string, message: string, path: string): Response {
	return Response.json({ timestamp: Date.now(), status, error, message, path }, { status })
}
