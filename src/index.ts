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
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;
		switch (pathname) {
			case '/start':
				await env.MODELS_AGGREGATION_FETCH_QUEUE.send(0);
				return getResponse('Started');
			case '/init':
				try {
					const { results } = await env.MODELS_AGGREGATION_DB.prepare(initTablesStmt)
						.all();
					return getResponse('initialized ' + JSON.stringify(results));
				} catch(e) {
					console.log(e);
					
					return new Response('Unable to init database, ' + e)
				}

			case '/preview':
				let content = '';
				try {
					const models = await env.MODELS_AGGREGATION_DB.prepare(
						'SELECT * FROM Models'
					)
						.all();
					const brands = await env.MODELS_AGGREGATION_DB.prepare(
						'SELECT * FROM Brands'
					)
						.all();
					const products = await env.MODELS_AGGREGATION_DB.prepare(
						'SELECT * FROM Products'
					)
						.all();
						
					content = '<hr/>' + renderList('Brands', brands.results) + "<hr />" + renderList('Models', models.results) + '<hr/>' + renderList('Produtcs', products.results);
				} catch(e) {
					content = 'Initialize database first (press RESET)'
				}
				return getResponse(content);

			default: 
				return getResponse('Initialize DB before previewing or processing');
		}

	},

	async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
		const offset = Number(batch.messages[0].body);
		
		console.log('handle queue item with offset', offset);
		
		const {items, hasNextPage, totalItems} = await fetchItems(offset);
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

function getResponse(content: string): Response {
	const menu = `
		<div>
			<div>
				<a href="/init">(RE)INITIALIZE DATABASE</a>
			</div>
			<div>
				<a href="/start">START PROCESSING</a>
			</div>
			<div>
				<a href="/preview">PREVIEW DATA</a>
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

async function fetchItems(offset: number): Promise<ProductsFetchData> {
	// Now we use filter by model name to prevent all tires parsing. (Remove filter for real data mapping)
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
				'x-api-key': 'b798bc72354a6d7256496c852508f054',
				'x-bot-bypass': '3dedee46815eff572aa1a1c1d3cb79be'
			}
		}
	);

	const json = await response.json();
	const allTires: {items: Product[], pageInfo: {hasNextPage: boolean, totalCount: number}} = json.data.allTires;

	return {
		items: allTires.items, 
		hasNextPage: allTires.pageInfo.hasNextPage,
		totalItems: allTires.pageInfo.totalCount
	};
}

async function processItem(product: Product, env: Env) {
	// console.log('processing item', product.id);
	
	let brandId: number | null = await checkIfBrandExists(product.brand, env);

	if (!brandId) {
		// console.log('brand', product.brand, 'does not exist');
		
		brandId = await addBrand(product.brand, env);
	}

	if (brandId) {
		let modelId: number | null = await checkIfModelExists(product.modelName, brandId, env);
		if (!modelId) {
			modelId = await addModel(product.modelName, brandId, product.modelTaxonId, env);
		}

		if (modelId) {
			await addProduct(product, modelId, env);
		}
	}
	
}

async function checkIfBrandExists(brandName: string, env: Env): Promise<number | null> {
	const { results } = await env.MODELS_AGGREGATION_DB.prepare(
			`SELECT * FROM Brands
				WHERE brandName = ?`
		)
		.bind(brandName)
		.all();
	
	return Number(results?.[0]?.brandId) || null;
}

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

async function checkIfModelExists(modelName: string, brandId: number, env: Env): Promise<number | null> {
	const { results } = await env.MODELS_AGGREGATION_DB.prepare(
			`SELECT * FROM Models
				WHERE modelName = ? AND brandId = ?`
		)
			.bind(modelName, brandId)
			.all();
	
	return Number(results?.[0]?.modelId) || null;
}

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