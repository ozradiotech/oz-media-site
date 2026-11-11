import type { APIRoute } from 'astro';
import { chatErrorResponse, isChatServerConfigured, moderatorRole, verifyChatRequest } from '../../lib/chat-server';

export const prerender = false;

/** The signed-in user's chat role (`dev`, `operator`, `host`, `mod`), or null. The chat shows moderation tools for any role. */
export const POST: APIRoute = async ({ request }) => {
	if (!isChatServerConfigured) return Response.json({ role: null });
	try {
		const user = await verifyChatRequest(request);
		return Response.json({ role: (await moderatorRole(user)) ?? null });
	} catch (error) {
		return chatErrorResponse(error);
	}
};
