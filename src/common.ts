export type TProductType = 'tires' | 'wheels';
export type TActionType = 'collect' | 'update' | 'delete';
export type TModel = {
    modelName: string;
    brandName: string;
    modelTaxonId?: string;
};

export type TRebate = {
    brandId: string;
    detailedDescription: string;
    expiresAt: string;
    id: string;
    img: string;
    instantRebate: boolean;
    name: string;
    price: number;
    shortDescription: string;
    startsAt: string;
    submissionDate: string;
    submissionLink: string;
    title: string;
};

export type TRawQueueMessage = {
	type: TProductType;
	action: TActionType;
	offset: number;
	lastUpdate?: string;
    sessionId: number;
};

export type TSystemStatus = 'Collecting' | 'Updating' | 'Finished' | 'Stopped' | 'Failed' | 'Idle';

export type TSystemState = {
    lastSessionId: number;
    tiresProcessed: number;
    tiresTotal: number;
    wheelsProcessed: number;
    wheelsTotal: number;
    status: TSystemStatus;
}

export const EMPTY_SYSTEM_STATE: TSystemState = {
    lastSessionId: Date.now(),
    tiresProcessed: 0,
    tiresTotal: 0,
    wheelsProcessed: 0,
    wheelsTotal: 0,
    status: 'Idle'
}

const MAX_ARGUMENTS_PER_QUERY = 32;
export const LAST_UPDATE_KV_KEY = 'lastUpdate';

// save multiple brands to the correspondong D1 table
export async function addBulkBrands(brandNames: string[], env: Env, type: TProductType): Promise<void> {
    const values = Array(brandNames.length).fill('(?)').join(',');

    const table = type === 'tires' ? 'TireBrands' : 'WheelBrands';

    const query = `
		INSERT OR IGNORE INTO ${table} (brandName)
			VALUES ${values};
	`;

    try {
        env.MODELS_AGGREGATION_DB.prepare(query)
            .bind(...brandNames)
            .run();
    } catch (e) {
        console.log(`Unable to save brands for type ${type}`, e);
        console.log(query);


    }
}

// save multiple models to the correspondong D1 table
export async function addBulkModels(modelsData: TModel[], env: Env, type: TProductType): Promise<void> {

    const parsedModelsData = modelsData.map(model => convertModelToArray(model));

    const values = parsedModelsData.map(parsedData => '(' + Array(parsedData.length).fill('?').join(',') + ')')
        .join(',');

    const table = type === 'tires' ? 'TireModels' : 'WheelModels';

    const query = `INSERT OR IGNORE INTO ${table} (modelName, brandName, modelTaxonId)
			VALUES ${values};`;

    try {
        await env.MODELS_AGGREGATION_DB.prepare(query)
            .bind(...parsedModelsData.flat())
            .run();
    } catch (e) {
        console.log(`Unable to add models for type ${type}`, e);
        console.log(query);
        console.log(parsedModelsData);
    }

    function convertModelToArray(model: TModel) {
        const { brandName, modelName, modelTaxonId } = model;

        return [
            modelName,
            brandName,
            modelTaxonId || null,
        ];
    }
}

export async function recursiveExecute<T>(items: T[], env: Env, type: TProductType, handler: Function, maxItems?: number): Promise<void> {
    if (!items.length) {
        return;
    }
    const maxItemsPerQuery = maxItems || getMaxItemsPerQuery<T>(items[0]);
    let currentItems = items.slice(0, maxItemsPerQuery);
    let restItems = items.slice(maxItemsPerQuery);

    await handler(currentItems, env, type);

    if (restItems.length) {
        await recursiveExecute(restItems, env, type, handler, maxItemsPerQuery);
    }
}

function getMaxItemsPerQuery<T>(item: T): number {
    const keysPerItem = Array.isArray(item) ? item.length : Object.keys(item as Object).length;
    return Math.floor(MAX_ARGUMENTS_PER_QUERY / keysPerItem);
}

export async function fetchItemsFromAPI<T>(query: string, env: Env): Promise<T> {
    const requestData = JSON.stringify({
        query
    });

    const response = await fetch(
        // 'http://tireagent-graphql-sandbox.ugjpwrwwth.us-east-1.elasticbeanstalk.com/api/graphql',
        'https://graphql.tireagent.com/api/graphql',
        {
            method: 'post',
            body: requestData,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.API_KEY,
                // 'x-bot-bypass': env.BOT_BYPASS_KEY
            }
        }
    );
    const clone = response.clone();

    try {
        return await response.json();
    } catch (err) {
        console.error(await clone.text());

        throw err;
    }
}

export async function addBulkRebates(rebates: TRebate[], env: Env, type: TProductType): Promise<void> {
    const table = type === 'tires' ? 'TireRebates' : 'WheelRebates';
    const valuePlaceholders = rebates.map(rebateData => '(' + Array(Object.keys(rebateData).length).fill('?').join(',') + ')')
        .join(',');
    const query = `INSERT OR REPLACE INTO ${table} (
        brandId,
        detailedDescription,
        expiresAt,
        id,
        img,
        instantRebate,
        name,
        price,
        shortDescription,
        startsAt,
        submissionDate,
        submissionLink,
        title
    )
    VALUES ${valuePlaceholders};`;

    const preparedRebates = rebates.map(rebate => convertRebateToArray(rebate));

    try {
        await env.MODELS_AGGREGATION_DB.prepare(query)
            .bind(...preparedRebates.flat())
            .run();
    } catch (e) {
        console.log('Unable to save rebates', e);
        console.log(rebates);

        console.log(query);
    }

    function convertRebateToArray(rebate: TRebate) {
        const {
            brandId,
            detailedDescription,
            expiresAt,
            id,
            img,
            instantRebate,
            name,
            price,
            shortDescription,
            startsAt,
            submissionDate,
            submissionLink,
            title
        } = rebate;

        return [
            brandId,
            detailedDescription,
            expiresAt,
            id,
            img,
            instantRebate,
            name,
            price,
            shortDescription,
            startsAt,
            submissionDate,
            submissionLink,
            title
        ];
    }

}

export async function bulkDeleteRebatesById(ids: string[], env: Env, type: TProductType) {
    const table = type === 'tires' ? 'tireRebates' : 'wheelRebates';
    const query = `DELETE FROM ${table} WHERE id IN (${ids})`;

    try {
        await env.MODELS_AGGREGATION_DB.prepare(query)
            .run();
        console.log(getCurrentTime(), `Deleted ${table} with id ${ids}`);

    } catch (e) {
        console.log(getCurrentTime(), `Unable to delete ${table} with id ${ids}`, e);
    }
}

export async function checkAndDeleteRebates(newRebates: TRebate[], type: TProductType, env: Env) {
    const table = type === 'tires' ? 'tireRebates' : 'wheelRebates';
    const savedRebatesQuery = `SELECT * FROM ${table}`;
    const savedRebates: TRebate[] = (await getAllEntriesFromDbByQuery(savedRebatesQuery, env)).results as TRebate[];
    const savedRebateIds = savedRebates.map((savedRebate) => savedRebate.id);
    const rebateToUpdateIds = newRebates.map(rebate => rebate.id);
    const rebateToDeleteIds = savedRebateIds.filter(id => !rebateToUpdateIds.includes(id));

    await recursiveExecute(rebateToDeleteIds, env, type, bulkDeleteRebatesById);
}

export async function bulkDeleteProductsById(ids: string[], env: Env, type: TProductType) {
    const table = type === 'tires' ? 'tireProducts' : 'wheelProducts';
    console.log('TABLE!!!!!', table, type);
    

    const query = `DELETE FROM ${table} WHERE id IN (${ids})`;

    try {
        await env.MODELS_AGGREGATION_DB.prepare(query)
            .run();
        console.log(getCurrentTime(), `Deleted ${table} with id ${ids}`);

    } catch (e) {
        console.log(getCurrentTime(), `Unable to delete ${table} with id ${ids}`, e);
    }
}

export function getCurrentTime(): string {
    return new Date().toTimeString().split(' ')[0];
}


// get all entries from the D1 database by given query
export async function getAllEntriesFromDbByQuery(query: string, env: Env) {
    return await env.MODELS_AGGREGATION_DB.prepare(query)
        .all();
}

// generate basic page with given content
export function getResponse(content: string): Response {
	const menu = `
		<div style="display: flex; gap: 20px; white-space: nowrap">
            <div>
				<a href="/">HOME</a>
			</div>
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
            <div style="flex: 1 1 100%; text-align: right">
                <a href="/logout">Logout</a>
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

export function updateLastUpdatedDate(env: Env) {
	env.PRODUCTS_AGGREGATION_KV.put(LAST_UPDATE_KV_KEY, new Date().toISOString());
}

export async function updateSystemState(newState: TSystemState, env: Env) {
	await env.PRODUCTS_AGGREGATION_KV.put('systemState', JSON.stringify(newState));
}

export async function getSystemState(env: Env): Promise<TSystemState | null> {
	const stateJSON = await env.PRODUCTS_AGGREGATION_KV.get('systemState');
	try {
		if (!stateJSON) {
			throw Error('No state in the store');
		}
		return JSON.parse(stateJSON)
	} catch (e) {
		console.log('Unable to parse sytems state from the store', e);
		return null;
	}
}