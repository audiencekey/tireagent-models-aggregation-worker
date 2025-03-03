import { getAllEntriesFromDbByQuery, getCurrentTime, LAST_UPDATE_KV_KEY, TActionType, TProductType } from './common';
import { initTablesStmt } from './init';
import { collectTires, deleteTires, updateTires } from './tires';
import { collectWheels, deleteWheels, updateWheels } from './wheels';

type TRawQueueMessage = {
	type: TProductType;
	action: TActionType;
	offset: number;
	lastUpdate?: string;
};

const FETCH_LIMIT = 500;

export default {

	// show UI, execute functionality due to selected URL
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const handlersMap: Record<string, (env: Env) => Promise<Response>> = {
			'/start': startCollecting,
			'/init': initializeDatabase,
			'/update': startUpdating,
			'/preview': previewData,
			'/': showHomePage,
			// '/export': exportDatabase
		};

		const handler = handlersMap[pathname];

		if (!handler) {
			return Response.redirect(url.origin);
		}

		return await handler(env);
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
			console.log(getCurrentTime(), 'No more products to update');
			env.PRODUCTS_AGGREGATION_KV.put(LAST_UPDATE_KV_KEY, new Date().toISOString());
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

// show static page with base info
export async function showHomePage(): Promise<Response> {
	return Promise.resolve(getResponse(`
		<h1>
			Initialize DB before previewing or processing.<br/>
			WARNING!!! all existing data will be deleted pemanently!
		</h1>
	`));
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

export async function startUpdating(env: Env): Promise<Response> {
	// await env.PRODUCTS_AGGREGATION_KV.put(LAST_UPDATE_KV_KEY, '2023-03-06T16:04:38Z');
	const lastUpdate = await env.PRODUCTS_AGGREGATION_KV.get(LAST_UPDATE_KV_KEY);

	const initialMessage: TRawQueueMessage = {
		type: 'tires',
		action: 'update',
		offset: 0,
		lastUpdate: lastUpdate || ''
	};
	await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(initialMessage));
	return getResponse('Updating started');

}

// show page with all brands, models and products from D1 database
// TODO decide what to do with this page since there can be too many products to show at once
export async function previewData(env: Env): Promise<Response> {
	// const date = '2025-02-23T12:15:35.791Z';
	// console.log(date);
	// await env.PRODUCTS_AGGREGATION_KV.put('last-update', date);

	// console.log(await env.PRODUCTS_AGGREGATION_KV.get('last-update'));

	// env.MODELS_AGGREGATION_DB.prepare(`INSERT OR REPLACE INTO wheelRebates (
    //     brandId,
    //     detailedDescription,
    //     expiresAt,
    //     id,
    //     img,
    //     instantRebate,
    //     name,
    //     price,
    //     shortDescription,
    //     startsAt,
    //     submissionDate,
    //     submissionLink,
    //     title
    // )
    // VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?);`)
	// .bind(
	// 	'1',
    //     'Detailed Description',
    //     '2025-02-23T12:15:35.791Z',
    //     '123456',
    //     'https://example.com/tire-rebate-img.jpg',
    //     true,
    //     'Tire Rebate 1',
    //     10.99,
    //     'Short Description',
    //     '2025-02-23T12:15:35.791Z',
    //     '2025-02-23T12:15:35.791Z',
    //     'https://example.com/tire-rebate-submission.html',
    //     'Tire Rebate 1 Title'
	// )
	// .run();

	let content = '';
	try {
		const [
			tireModels,
			tireBrands,
			tireRebates,
			tireProducts,
			wheelModels,
			wheelBrands,
			wheelRebates,
			wheelProducts
		] = await Promise.all([
			getAllEntriesFromDbByQuery('SELECT * FROM TireModels', env),
			getAllEntriesFromDbByQuery('SELECT * FROM TireBrands', env),
			getAllEntriesFromDbByQuery('SELECT * FROM TireRebates', env),
			getAllEntriesFromDbByQuery('SELECT * FROM TireProducts', env),
			getAllEntriesFromDbByQuery('SELECT * FROM WheelModels', env),
			getAllEntriesFromDbByQuery('SELECT * FROM WheelBrands', env),
			getAllEntriesFromDbByQuery('SELECT * FROM WheelRebates', env),
			getAllEntriesFromDbByQuery('SELECT * FROM WheelProducts', env),
		]);
		content = `
			<hr/> 
			<div style="display: flex; gap: 10px; word-break: break-word">
				<div style="flex: 0 0 50%">
					<h2>Tires</h2>
					${renderList('Brands', tireBrands.results)}
					<hr />
					${renderList('Models', tireModels.results)}
					<hr/>
					${renderList('Rebates', tireRebates.results)}
					<hr/>
					${renderList('Produtcs', tireProducts.results)}
				</div>
				<div style="flex: 0 0 50%">
					<h2>Wheels</h2>
					${renderList('Brands', wheelBrands.results)}
					<hr />
					${renderList('Models', wheelModels.results)}
					<hr/>
					${renderList('Rebates', wheelRebates.results)}
					<hr/>
					${renderList('Produtcs', wheelProducts.results)}
				</div>
			</div>
		`;
	} catch (e) {
		content = '<h3>Initialize database first</h3>';
	}

	return getResponse(content);
}

// generate basic page with given content
export function getResponse(content: string): Response {
	const menu = `
		<div style="display: flex; gap: 20px;">
			<div>
				<a href="/init">(RE)INITIALIZE DATABASE</a>
			</div>
			<div>
				<a href="/start">START COLLECTING</a>
			</div>
			<div>
				<a href="/preview">PREVIEW PARSED DATA</a>
			</div>
			<div>
				<a href="/update">UPDATE PARSED DATA</a>
			</div>
		</div>
	`;

	const fullContent = menu + `<div>` + content + '</div>';

	return new Response(fullContent, {
		headers: {
			'Content-Type': 'text/html'
		}
	});
}

// convert items list to the HTML string
export function renderList(title: string, items: Array<any>): string {
	let str = '<div>';
	str += `<h2>${title}</h2>`;
	str += `<details>`;
	str += `<summary>Total ${items.length} items:</summary>`;
	if (items.length < 1000) {
		str += `<ol style="max-height: 80vh; overflow-y: auto;">`;
		items.forEach((item, index) => {
			str += `<li>${JSON.stringify(item)}<br /> <br /></li>`;
		});
		str += `</ol>`;
	} else {
		for (let i = 0; i < items.length; i += 1000) {
			const max = Math.min(i + 1000, items.length);
			str += `<div>`;
			str += `<details style="padding-left: 10px;">`;
			str += `<summary>Items ${i}-${max - 1}:</summary>`;
			str += `<ol style="max-height: 80vh; overflow-y: auto; padding-left: 50px;" start="${i}"}>`;
			items.slice(i, max).forEach((item) => {
				str += `<li>${JSON.stringify(item)}<br /> <br /></li>`;
			});
			str += `</ol>`;
			str += `</details>`;
			str += `</div>`;

		}
	}
	str += '</details></div>';

	return str;
}