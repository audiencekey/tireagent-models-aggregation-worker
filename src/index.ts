import { FREE_ACCESS_ROUTES, getNewSession, PROTECTEDR_ROUTES } from './auth';
import { EMPTY_SYSTEM_STATE, getCurrentTime, getResponse, getSystemState, TProductType, TRawQueueMessage, TSystemState, TSystemStatus, updateLastUpdatedDate, updateSystemState } from './common';
import { handleLogout, initializeDatabase, previewData, showHomePage, showLoginPage, showRegisterPage, startCollecting, startUpdating, stopProcessing } from './get-handlers';
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
			'/stop': stopProcessing,
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
		const currentState = await getSystemState(env);

		try {
			message = JSON.parse(batch.messages[0].body as string);
		} catch (e) {
			console.log(getCurrentTime(), 'Invalid queue message format', e);
			return;
		}

		const { offset, type, action, lastUpdate, sessionId } = message;
		
		if (currentState) {
			const {status, lastSessionId} = currentState;
		
			if (lastSessionId !== sessionId) {
				console.log(getCurrentTime(), 'Attempt to run concurrent process');
			
				return;
			}

			if (status === 'Stopped') {
				console.log(getCurrentTime(), 'Received Stop sygnal; process terminated');
				return; 
			}
		}

		if (action === 'collect') {
			return await handleCollectAction(type, offset, env, sessionId);
		}
		if (action === 'update' && !!lastUpdate?.length) {
			return await handleUpdateAction(type, offset, lastUpdate, env, sessionId);
		}
		if (action === 'delete' && !!lastUpdate?.length) {
			return await handleDeleteAction(type, offset, lastUpdate, env, sessionId);
		}

		console.log(getCurrentTime(), 'Invalid update message. Action: ' + action + ', last update: ' + lastUpdate);

		
		return;
	}
} satisfies ExportedHandler<Env>;

export async function handleCollectAction(type: TProductType, offset: number, env: Env, sessionId: number): Promise<void> {
	const handlers = {
		'tires': collectTires,
		'wheels': collectWheels
	};
	const hasNextPage = await handlers[type](offset, FETCH_LIMIT, env);

	if (hasNextPage === null) {
		console.log(getCurrentTime(), 'Failed to save product');
		const currentState: TSystemState = (await getSystemState(env)) || EMPTY_SYSTEM_STATE;
		const newState: TSystemState = {...currentState, status: 'Failed'};
		await updateSystemState(newState, env);
		return;
	}

	if (hasNextPage) {
		// if (offset === 0) {
		const message: TRawQueueMessage = {
			offset: offset + FETCH_LIMIT,
			action: 'collect',
			type,
			sessionId
		};
		await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
	} else {
		if (type === 'tires') {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'collect',
				type: 'wheels',
				sessionId
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		} else {
			updateLastUpdatedDate(env);
			console.log(getCurrentTime(), 'No more products to collect');
			const currentState: TSystemState = (await getSystemState(env)) || EMPTY_SYSTEM_STATE;
			const newState: TSystemState = {...currentState, status: 'Finished'};
			await updateSystemState(newState, env);
		}
	}
}

export async function handleUpdateAction(type: TProductType, offset: number, lastUpdate: string, env: Env, sessionId: number): Promise<void> {
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
			lastUpdate,
			sessionId
		};
		await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
	} else {
		if (type === 'tires') {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'update',
				type: 'wheels',
				lastUpdate,
				sessionId
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		} else {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'delete',
				type: 'tires',
				lastUpdate,
				sessionId
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		}
	}
}

export async function handleDeleteAction(type: TProductType, offset: number, lastUpdate: string, env: Env, sessionId: number): Promise<void> {
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
			lastUpdate,
			sessionId
		};
		await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
	} else {
		if (type === 'tires') {
			const message: TRawQueueMessage = {
				offset: 0,
				action: 'delete',
				type: 'wheels',
				lastUpdate,
				sessionId
			};

			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		} else {
			updateLastUpdatedDate(env);

			updateLastUpdatedDate(env);
			console.log(getCurrentTime(), 'No more products to update');

			const currentState: TSystemState = (await getSystemState(env)) || EMPTY_SYSTEM_STATE;
			const newState: TSystemState = {...currentState, status: 'Finished'};
			await updateSystemState(newState, env);
		}
	}
}