import { initTablesStmt } from './init';

type Product = {
	availability: string;
	brand: string;
	currency: string;
	description: string;
	dualLoadIndex: number;
	dualMaxInflationPressure: number;
	dualMaxLoad: number;
	featured: boolean;
	id: string;
	imageUrl: string;
	loadIndex: number;
	maxInflationPressure: number;
	maxLoad: number;
	modelName: string;
	modelTaxonId: string;
	mpn: string;
	overallDiameter: number;
	price: number;
	revsPerMile: number;
	rimWidthRange: string;
	roadCondition: string;
	sectWidth: number;
	sidewall: string;
	sizeDesc: string;
	sku: string;
	speedRating: string;
	temperature: string;
	traction: string;
	treadDepth: number;
	treadType: string;
	treadwear: string;
	url: string;
	utqg: string;
	warranty: string;
	size: {
		aspectRatio: number;
		diameter: number;
		width: number;
	}
}

type ProductsFetchData = {
	items: Product[];
	hasNextPage: boolean;
	totalItems: number;
}

const FETCH_LIMIT = 500;

export default {

	// show UI, execute functionality due to selected URL
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		const handlersMap: Record<string, (env: Env) => Promise<Response>> = {
			'/start': startProcessing,
			'/init': initializeDatabase,
			'/preview': previewData,
			'/': showHomePage
		}

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
		
		const offset = Number(batch.messages[0].body);
		
		console.log('handle queue item with offset', offset);
		
		const {items, hasNextPage, totalItems} = await fetchItems(offset, env);
		console.log(items.length);
		
		
		for(let item of items) {
			try {
				await processItem(item, env);
			} catch(e) {
				console.log('Unable to process item', item);
				console.log(e);
			}
		}

		// console.log('hasNextPage', hasNextPage);

		console.log(`Processed ${offset + items.length} items out of ${totalItems}`);		

		if (hasNextPage) {
			await env.MODELS_AGGREGATION_FETCH_QUEUE.send(offset + FETCH_LIMIT);
		} else {
			console.log('END!!!');
		}

	}
} satisfies ExportedHandler<Env>;

// send message to the queue with 0 offset to start data processing
async function startProcessing(env: Env): Promise<Response> {
	await env.MODELS_AGGREGATION_FETCH_QUEUE.send(0);
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
	} catch(e) {
		console.log(e);
		
		return new Response('Unable to init database, ' + e)
	}
}

// show page with all brands, models and products from D1 database
// TODO decide what to do with this page since there can be too many products to show at once
async function previewData(env: Env): Promise<Response> {
	let content = '';
	try {
		const [models, brands, products] = await Promise.all([
			getAllEntriesFromDbByQuery('SELECT * FROM Models', env),
			getAllEntriesFromDbByQuery('SELECT * FROM Brands', env),
			getAllEntriesFromDbByQuery('SELECT * FROM Products', env),
		]);	
		content = `<hr/> 
			${renderList('Brands', brands.results)}
			<hr />
			${renderList('Models', models.results)}
			<hr/>
			${renderList('Produtcs', products.results)}`;
	} catch(e) {
		content = '<h3>Initialize database first</h3>'
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
		</div>
	`;

	const fullContent = menu + `<div>` + content + '<div>';

	return new Response(fullContent, {
		headers: {
			'Content-Type': 'text/html'
		}
	})
}

// convert items list to the HTML string
function renderList(title: string, items: Array<any>): string {
	let str = '<div>';
	str += `<h2>${title}</h2>`
	str += `<div>Total ${items.length} items:</div>`
	items.forEach((item, index) => {
		str += `<strong>${index + 1}.</strong> ${JSON.stringify(item)}<br /><br />`
	});
	
	str += '</div>';
	
	return str;
}

// fetch data from the API by given offset
async function fetchItems(offset: number, env: Env): Promise<ProductsFetchData> {
	type TAllTiresResponse = {
		data: {
			allTires: {
				items: Product[], 
				pageInfo: {
					hasNextPage: boolean, 
					totalCount: number
				}
			}
		}
	}
	// TODO Now we use filter by model name to prevent all tires parsing. (Remove filter for real data mapping)
	const requestData = JSON.stringify({
		query: `query AllTires {
			allTires(limit: ${FETCH_LIMIT}, offset: ${offset}, modelName: "AT") {
				items {
					availability
					brand
					currency
					description
					dualLoadIndex
					dualMaxInflationPressure
					dualMaxLoad
					featured
					id
					imageUrl
					loadIndex
					maxInflationPressure
					maxLoad
					modelName
					modelTaxonId
					mpn
					overallDiameter
					price
					revsPerMile
					rimWidthRange
					roadCondition
					sectWidth
					sidewall
					sizeDesc
					sku
					speedRating
					temperature
					traction
					treadDepth
					treadType
					treadwear
					url
					utqg
					warranty
					size {
						aspectRatio
						diameter
						width
					}
				}
				pageInfo {
					hasNextPage
					limit
					offset
					totalCount
				}
			}
		}`
	});

	const response = await fetch(
		'https://graphql.tireagent.com/api/graphql',
		{
			method: 'post',
			body: requestData,
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': env.API_KEY,
				'x-bot-bypass': env.BOT_BYPASS_KEY
			}
		}
	);

	const json: TAllTiresResponse = await response.json();
	console.log(json);
	
	const {
		items, 
		pageInfo: {
			hasNextPage, 
			totalCount
		}
	} = json.data.allTires;

	return {
		items, 
		hasNextPage,
		totalItems: totalCount
	};
}

// save item and corresponding brand and model to the D1 database
async function processItem(product: Product, env: Env) {
	// console.log('processing item', product.id);
	
	let brandId: number | null = await getBrandId(product.brand, env);

	if (!brandId) {
		// console.log('brand', product.brand, 'does not exist');
		
		brandId = await addBrand(product.brand, env);
	}

	if (brandId) {
		let modelId: number | null = await getModelId(product.modelName, brandId, env);
		if (!modelId) {
			modelId = await addModel(product.modelName, brandId, product.modelTaxonId, env);
		}

		if (modelId) {
			await addProduct(product, modelId, env);
		}
	}
	
}

// find brand in the D1 database by name and return it's id. Return null if brand does not exist
async function getBrandId(brandName: string, env: Env): Promise<number | null> {
	const { results } = await env.MODELS_AGGREGATION_DB.prepare(
			`SELECT * FROM Brands
				WHERE brandName = ?`
		)
		.bind(brandName)
		.all();
	
	return Number(results?.[0]?.brandId) || null;
}

// add new brand to the D1 database
async function addBrand(brandName: string, env: Env): Promise<number | null> {
	await env.MODELS_AGGREGATION_DB.prepare(`
		INSERT INTO Brands (brandName)
			VALUES (?);
	`)
		.bind(brandName)
		.run();

	const {results } = await env.MODELS_AGGREGATION_DB.prepare('SELECT last_insert_rowid();')
		.run();

	// console.log(`Brand ${brandName} added`);
	

	return Number(results[0]?.['last_insert_rowid()']) || null;
}

// find model in the D1 database by name and return it's id. Return null if model does not exist
async function getModelId(modelName: string, brandId: number, env: Env): Promise<number | null> {
	const { results } = await env.MODELS_AGGREGATION_DB.prepare(
			`SELECT * FROM Models
				WHERE modelName = ? AND brandId = ?`
		)
			.bind(modelName, brandId)
			.all();
	
	return Number(results?.[0]?.modelId) || null;
}

// add new model to the D1 database
async function addModel(modelName: string, brandId: number, modelTaxonId: string, env: Env): Promise<number | null> {
	await env.MODELS_AGGREGATION_DB.prepare(`
		INSERT INTO Models (modelName, brandId, modelTaxonId)
			VALUES (?,?,?);
	`)
		.bind(modelName, brandId, modelTaxonId)
		.run();

	const {results } = await env.MODELS_AGGREGATION_DB.prepare('SELECT last_insert_rowid();')
		.run();

	// console.log(`Model ${modelName} added`);
	

	return Number(results[0]?.['last_insert_rowid()']) || null;
}

// add new product to the D1 database
async function addProduct(productData: Product, modelId: number, env: Env) {
	const result = await env.MODELS_AGGREGATION_DB.prepare(`
		INSERT INTO Products (
			availability,
			currency,
			description,
			dualLoadIndex,
			dualMaxInflationPressure,
			dualMaxLoad,
			featured,
			id,
			imageUrl,
			loadIndex,
			maxInflationPressure,
			maxLoad,
			mpn,
			overallDiameter,
			price,
			revsPerMile,
			rimWidthRange,
			roadCondition,
			sectWidth,
			sidewall,
			sizeDesc,
			sku,
			speedRating,
			temperature,
			traction,
			treadDepth,
			treadType,
			treadwear,
			url,
			utqg,
			warranty,
			aspectRatio,
			diameter,
			width,
			ModelId
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
	`)
	.bind(
		productData.availability,	
		productData.currency,	
		productData.description,	
		productData.dualLoadIndex,	
		productData.dualMaxInflationPressure,	
		productData.dualMaxLoad,	
		productData.featured,	
		productData.id,	
		productData.imageUrl,	
		productData.loadIndex,	
		productData.maxInflationPressure,	
		productData.maxLoad,	
		productData.mpn,	
		productData.overallDiameter,	
		productData.price,	
		productData.revsPerMile,	
		productData.rimWidthRange,	
		productData.roadCondition,	
		productData.sectWidth,	
		productData.sidewall,	
		productData.sizeDesc,	
		productData.sku,	
		productData.speedRating,	
		productData.temperature,	
		productData.traction,	
		productData.treadDepth,	
		productData.treadType,	
		productData.treadwear,	
		productData.url,	
		productData.utqg,	
		productData.warranty,	
		productData.size.aspectRatio,	
		productData.size.diameter,	
		productData.size.width,	
		modelId
	)
	.run();

	// console.log('Product' + productData.id + ' added');
}