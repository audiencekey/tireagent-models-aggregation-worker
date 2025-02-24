import { LAST_UPDATE_KV_KEY, TProductType } from './common';
import { initTablesStmt } from './init';
import { processTires } from './tires';
import { processWheels } from './wheels';

type TRawQueueMessage = {
	type: TProductType;
	offset: number;
	lasUpdate?: string;
};

const FETCH_LIMIT = 500;

export default {

	// show UI, execute functionality due to selected URL
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const handlersMap: Record<string, (env: Env) => Promise<Response>> = {
			'/start': startProcessing,
			'/init': initializeDatabase,
			'/update': updateDatabase,
			'/preview': previewData,
			'/': showHomePage,
			'/export': exportDatabase
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
			console.log('Invalid queue message format', e);
			return;
		}
		console.log(message);


		const { offset, type } = message;

		const handlers = {
			'tires': processTires,
			'wheels': processWheels
		};
		const hasNextPage = await handlers[type](offset, FETCH_LIMIT, env);

		if (hasNextPage === null) {
			console.log('failed to save product');
			return;
		}

		if (hasNextPage) {
			// if (offset === 0) {
			const message: TRawQueueMessage = {
				offset: offset + FETCH_LIMIT,
				type
			};
			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
		} else {
			if (type === 'tires') {
				const message: TRawQueueMessage = {
					offset: 0,
					type: 'wheels'
				};

				await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(message));
			} else {
				console.log('No more pages to process');
			}
		}

	}
} satisfies ExportedHandler<Env>;

// send message to the queue with 0 offset to start data processing tires first, wheels next
async function startProcessing(env: Env): Promise<Response> {
	const initialMessage = {
		type: 'tires',
		offset: 0
	};
	await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(initialMessage));
	return getResponse('Started');
}

// show static page with base info
async function showHomePage(): Promise<Response> {
	return Promise.resolve(getResponse(`
		<h1>
			Initialize DB before previewing or processing.<br/>
			WARNING!!! all existing data will be deleted pemanently!
		</h1>
	`));
}

// (re)initialize database
async function initializeDatabase(env: Env): Promise<Response> {
	try {
		const { results } = await env.MODELS_AGGREGATION_DB.prepare(initTablesStmt)
			.all();
		return getResponse('initialized ' + JSON.stringify(results));
	} catch (e) {
		console.log(e);

		return new Response('Unable to init database, ' + e);
	}
}

async function updateDatabase(env: Env): Promise<Response> {
	const lastUpdate = await env.PRODUCTS_AGGREGATION_KV.get(LAST_UPDATE_KV_KEY);

	await env.MODELS_AGGREGATION_DB.prepare(`
		DELETE FROM WheelProducts WHERE imageUrl = "test img"	
	`)
	.run()

	return getResponse('updating ');

}

// show page with all brands, models and products from D1 database
// TODO decide what to do with this page since there can be too many products to show at once
async function previewData(env: Env): Promise<Response> {
	const date = '2025-02-23T12:15:35.791Z';
	console.log(date);
	await env.PRODUCTS_AGGREGATION_KV.put('last-update', date);

	console.log(await env.PRODUCTS_AGGREGATION_KV.get('last-update'));

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

// get all entries from the D1 database by given query
async function getAllEntriesFromDbByQuery(query: string, env: Env) {
	return await env.MODELS_AGGREGATION_DB.prepare(query)
		.all();
}

// generate basic page with given content
function getResponse(content: string): Response {
	const menu = `
		<div style="display: flex; gap: 20px;">
			<div>
				<a href="/init">(RE)INITIALIZE DATABASE</a>
			</div>
			<div>
				<a href="/start">START PROCESSING</a>
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
function renderList(title: string, items: Array<any>): string {
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

async function exportDatabase(env: Env) {
	const accountId = '5d68a406dc066c38394a6b8a1f6e3a90';
	const databaseId = 'b717771c-4795-4261-b76c-39ea6136470c';
	const D1_REST_API_TOKEN = '';
	const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`;
	const method = "POST";
	const headers = new Headers();
	headers.append("Content-Type", "application/json");
	headers.append("Authorization", `Bearer ${D1_REST_API_TOKEN}`);
	return getResponse('export');
}