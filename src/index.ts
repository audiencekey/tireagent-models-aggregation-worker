import { FREE_ACCESS_ROUTES, getNewSession, PROTECTEDR_ROUTES } from './auth';
import { getCurrentTime, getResponse, TProductType, TRawQueueMessage, updateLastUpdatedDate } from './common';
import { handleLogout, previewData, showHomePage, showLoginPage, showRegisterPage, startUpdating } from './get-handlers';
import { initTablesStmt } from './init';
import { handleLogin, handleRegister } from './post-handlers';
import { collectTires, deleteTires, updateTires } from './tires';
import { collectWheels, deleteWheels, updateWheels } from './wheels';

const FETCH_LIMIT = 500;

export default {

	// show UI, execute functionality due to selected URL
	async fetch(request: Request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const {pathname} = url;
		const isProtectedRoute = PROTECTEDR_ROUTES.includes(pathname);
		const isFreeRoute = FREE_ACCESS_ROUTES.includes(pathname);

		if (!isProtectedRoute && !isFreeRoute) {
			return new Response('');
		}

		const newSession = await getNewSession(request, env);
		
		if (!newSession && isProtectedRoute) {
			return new Response(null,
				{
					status: 301,
					headers: {
						'Location': '/login'
					}
				});
		}

		if (newSession && isFreeRoute) {
			return new Response(null,
				{
					status: 301,
					headers: {
						'Location': '/',
						'Set-Cookie': `session=${newSession}; secure; HttpOnly; SameSite=Strict`
					}
				});
		}

		const postHandlersMap: Record<string, (request: Request, env: Env) => Promise<Response>> = {
			'/login': handleLogin,
			'/register': handleRegister
		}

		const getHandlersMap: Record<string, (env: Env, extra?: Record<string, any>) => Promise<Response>> = {
			'/start': startCollecting,
			'/init': initializeDatabase,
			'/update': startUpdating,
			'/preview': previewData,
			'/login': showLoginPage,
			'/register': showRegisterPage,
			'/logout': handleLogout,
			'/': showHomePage,
			// '/export': exportDatabase
		};
		
		if (request.method === 'GET') {
			const handler = getHandlersMap[pathname];

			if (!handler) {
				return Response.redirect(url.origin);
			}

			const response = await handler(env, {params: url.searchParams, request});

			if (isProtectedRoute && newSession) {
				response.headers.set('Set-Cookie', `session=${newSession}; secure; HttpOnly; SameSite=Strict`)
			}
			
			return response;
		}

		const postHandler = postHandlersMap[pathname];

		if (!postHandler) {
			return new Response('Invalid handler', {
				status: 500
			});
		}

		const response =  await postHandler(request, env);
		// if (newSession) {
		// 	response.headers.set('Set-Cookie', `session=${newSession}; secure; HttpOnly; SameSite=Strict`)
		// }
		return response;

	},

	/** 
	 * handle queue messages
	 * take query offset to get data chunk from the API and save to the D1 database
	 */
	async queue(batch: MessageBatch<unknown>, env: Env) {
		let message: TRawQueueMessage;
		try {
			message = JSON.parse(batch.messages[0].body as string);
		} catch (e) {
			console.log(getCurrentTime(), 'Invalid queue message format', e);
			return;
		}
		console.log(getCurrentTime(), message);
		const { offset, type, action, lastUpdate } = message;

		if (action === 'collect') {
			return await handleCollectAction(type, offset, env);
		}
		if (action === 'update' && !!lastUpdate?.length) {
			return await handleUpdateAction(type, offset, lastUpdate, env);
		}
		if (action === 'delete' && !!lastUpdate?.length) {
			return await handleDeleteAction(type, offset, lastUpdate, env);
		}

		console.log(getCurrentTime(), 'Invalid update message. Action: ' + action + ', last update: ' + lastUpdate);
		
		return;
	}
} satisfies ExportedHandler<Env>;

export async function handleCollectAction(type: TProductType, offset: number, env: Env): Promise<void> {
	const handlers = {
		'tires': collectTires,
		'wheels': collectWheels
	};
	const hasNextPage = await handlers[type](offset, FETCH_LIMIT, env);

	if (hasNextPage === null) {
		console.log(getCurrentTime(), 'Failed to save product');
		return;
	}

	if (hasNextPage) {
		// if (offset === 0) {
		const message: TRawQueueMessage = {
			offset: offset + FETCH_LIMIT,
			action: 'collect',
			type
		};
		await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
	} else {
		if (type === 'tires') {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'collect',
				type: 'wheels'
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		} else {
			updateLastUpdatedDate(env);
			console.log(getCurrentTime(), 'No more products to collect');
		}
	}
}

export async function handleUpdateAction(type: TProductType, offset: number, lastUpdate: string, env: Env): Promise<void> {
	if (!lastUpdate?.length) {
		console.log(getCurrentTime(), 'No lastUpdate date received, update process terminated');
		
		return;
	}
	const handlers = {
		'tires': updateTires,
		'wheels': updateWheels
	};
	const hasNextPage = await handlers[type](offset, FETCH_LIMIT, env, lastUpdate);

	if (hasNextPage === null) {
		console.log(getCurrentTime(), 'Failed to update products');
		return;
	}

	if (hasNextPage) {
		const message: TRawQueueMessage = {
			offset: offset + FETCH_LIMIT,
			action: 'update',
			type,
			lastUpdate
		};
		await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
	} else {
		if (type === 'tires') {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'update',
				type: 'wheels',
				lastUpdate
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		} else {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'delete',
				type: 'tires',
				lastUpdate
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		}
	}
}

export async function handleDeleteAction(type: TProductType, offset: number, lastUpdate: string, env: Env): Promise<void> {
	if (!lastUpdate?.length) {
		console.log(getCurrentTime(), 'No lastUpdate date received, delete process terminated');
		
		return;
	}
	const handlers = {
		'tires': deleteTires,
		'wheels': deleteWheels
	};
	const hasNextPage = await handlers[type](offset, FETCH_LIMIT, env, lastUpdate);

	if (hasNextPage === null) {
		console.log(getCurrentTime(), 'Failed to delete products');
		return;
	}

	if (hasNextPage) {
		const message: TRawQueueMessage = {
			offset: offset + FETCH_LIMIT,
			action: 'delete',
			type,
			lastUpdate
		};
		await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
	} else {
		if (type === 'tires') {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'delete',
				type: 'wheels',
				lastUpdate
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		} else {
			updateLastUpdatedDate(env);
			console.log(getCurrentTime(), 'No more products to update');
		}
	}
}

// send message to the queue with 0 offset to start data processing tires first, wheels next
export async function startCollecting(env: Env): Promise<Response> {
	const initialMessage: TRawQueueMessage = {
		type: 'tires',
		action: 'collect',
		offset: 0
	};
	await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(initialMessage));
	return getResponse('Processing started');
}

// (re)initialize database
export async function initializeDatabase(env: Env): Promise<Response> {
	try {
		const { results } = await env.MODELS_AGGREGATION_DB.prepare(initTablesStmt)
			.all();
		return getResponse('initialized ' + JSON.stringify(results));
	} catch (e) {
		console.log(e);

		return new Response('Unable to init database, ' + e);
	}
}