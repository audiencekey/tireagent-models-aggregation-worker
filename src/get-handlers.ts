import { logout } from './auth';
import { EMPTY_SYSTEM_STATE, getAllEntriesFromDbByQuery, getResponse, getSystemState, LAST_UPDATE_KV_KEY, renderList, TRawQueueMessage, TSystemState, TSystemStatus, updateLastUpdatedDate, updateSystemState } from './common';
import { initTablesStmt } from './init';

// show static page with base info
export async function showHomePage(env: Env): Promise<Response> {
    const state = await getSystemState(env);
    return getResponse(`
        <ul>
            <li><h2>Home to see current state</h2></li>
            <li><h2>(Re)initialize database to clear all data and prepare for new collecting. WARNING!!! All data will be lost!</h2></li>
            <li><h2>Start collecting to initialize data collecting process. Collecting on non-reinitialized DB can cause unpredictable results</h2></li>
            <li><h2>Preview Parse data to see all parsed data</h2></li>
            <li><h2>Update parsed data to fetch and update all data, changed on the API side after the last update</h2></li>
            <li><h2>Test aggregation to check response time for models aggregation request to the DB</h2></li>
        </ul>
        <div>
            ${JSON.stringify(state)}
        </div>
        ${state?.status === 'Collecting' || state?.status === 'Updating' ? '<h1><a href="/stop">Stop ' + state.status + '</h1>' : ""}
    `);
}

export async function testAggregation(env: Env): Promise<Response> {
    function getQuery(limit?: number, offset?: number) {
        let q1 = `
            SELECT modelName, 
                MIN(tp.price) as priceMin, 
                MAX(tp.price) as priceMax, 
                COUNT(*) as amount, 
                tp.brandName,
                tp.description,
                tr.price as rebate,
                GROUP_CONCAT(DISTINCT tp.warranty) as warranties,
                GROUP_CONCAT(DISTINCT tp.price) as prices,
                GROUP_CONCAT(DISTINCT tp.dualLoadIndex) as dualLoadIndexes,
                GROUP_CONCAT(DISTINCT tp.dualMaxInflationPressure) as dualMaxInflationPressures,
                GROUP_CONCAT(DISTINCT tp.dualMaxLoad) as dualMaxLoads,
                GROUP_CONCAT(DISTINCT tp.loadIndex) as loadIndexes,
                GROUP_CONCAT(DISTINCT tp.maxLoad) as maxLoads,
                GROUP_CONCAT(DISTINCT tp.mpn) as mpns,
                GROUP_CONCAT(DISTINCT tp.overallDiameter) as overallDiameters,
                GROUP_CONCAT(DISTINCT tp.revsPerMile) as revsPerMile,
                GROUP_CONCAT(DISTINCT tp.rimWidthRange) as rimWidthRanges,
                GROUP_CONCAT(DISTINCT tp.roadCondition) as roadConditions,
                GROUP_CONCAT(DISTINCT tp.sectWidth) as sectWidths,
                GROUP_CONCAT(DISTINCT tp.sidewall) as sidewalls,
                GROUP_CONCAT(DISTINCT tp.sizeDesc) as sizeDescs,
                GROUP_CONCAT(DISTINCT tp.sku) as skus,
                GROUP_CONCAT(DISTINCT tp.speedRating) as speedRatings,
                GROUP_CONCAT(DISTINCT tp.temperature) as temperatures,
                GROUP_CONCAT(DISTINCT tp.traction) as tractions,
                GROUP_CONCAT(DISTINCT tp.treadDepth) as treadDepths,
                GROUP_CONCAT(DISTINCT tp.treadType) as treadTypes,
                GROUP_CONCAT(DISTINCT tp.treadwear) as treadwears,
                GROUP_CONCAT(DISTINCT tp.utqg) as utqgs,
                GROUP_CONCAT(DISTINCT tp.aspectRatio) as aspectRatios,
                GROUP_CONCAT(DISTINCT tp.diameter) as diameters,
                GROUP_CONCAT(DISTINCT tp.width) as widths
            FROM TireProducts as tp
            LEFT JOIN TireRebates as tr ON tp.rebateId = tr.id
            WHERE NOT modelName IS NULL AND tp.price > 120 AND tp.price < 200
            GROUP BY modelName
        `;

        if (limit) {
            q1 += ` LIMIT ${limit}`;
        }
        if (offset) {
            q1 += ` OFFSET ${offset}`;
        }

        return q1;
    }
    const beforeFull = Date.now();
    await env.AK_PRODUCTS_D1.prepare(getQuery())
        .all();
    const afterFull = Date.now();

    const beforeLimit = Date.now();
    const res = await env.AK_PRODUCTS_D1.prepare(getQuery(20, 20))
        .all();
    const afterLimit = Date.now();
    console.log(res.results);
    
    return getResponse(`
        <div>For full tires dataset, aggregation took ${(afterFull - beforeFull) / 1000} seconds</div>
        <div>For tires dataset with limit 20, aggregation took ${(afterLimit - beforeLimit) / 1000} seconds</div>
    `);
}

export async function showLoginPage(env: Env, extra?: { errors?: string[], clearCookies?: boolean, name?: string, params?: URLSearchParams; }): Promise<Response> {
    const hasRegisteredMessage = !!extra?.params?.get('registered');
    let pageContent = `
    <h2 style="text-align: center">Log in</h2>
    <form method="POST" action="login" style="display:flex; flex-direction: column; align-items: center;">
    ${hasRegisteredMessage ? '<p>Now you can log in with your new account</p>' : ''}    
            <div style="display: grid; grid-template-columns: 200px 300px; justify-content: center; margin: 50px auto">
                <label for="name">Username</label>
                <input type="text" id="name" name="name" />
                <label for="password">Password</label>
                <input type="password" id="password" name="password" />
            </div>
            <button type="submit" style="width: 300px;">Log in</button>
    </form>
    `;

    const errors = extra?.errors || [];

    if (errors?.length) {
        errors.forEach(error => pageContent += `<div>${error}</div>`);
    }

    return Promise.resolve(new Response(pageContent, {
        headers: {
            'Content-Type': 'text/html'
        }
    }));
}

export function showRegisterPage(env: Env, extra: { errors?: string[], name?: string, params?: URLSearchParams; }): Promise<Response> {
    let pageContent = `
        <h2 style="text-align: center">Register</h2>
        <form method="POST" action="register"  style="display:flex; flex-direction: column; align-items: center;">
            <div style="display: grid; grid-template-columns: 200px 300px; justify-content: center; margin: 50px auto">
                <label for="name">Username</label>
                <input type="text" id="name" name="name" value="${extra?.name || ''}" />
                <label for="password">Password</label>
                <input type="password" id="password" name="password" />
                <label for="confirm-password">Confirm Password</label>
                <input type="password" id="confirm-password"  name="confirmPassword" />
            </div>
            <button type="submit" style="width: 300px;">Register</button>
        </form>
    `;

    const errors = extra?.errors || [];

    if (errors?.length) {
        errors.forEach(error => pageContent += `<div>${error}</div>`);
    }

    return Promise.resolve(new Response(pageContent, {
        headers: {
            'Content-Type': 'text/html'
        }
    }));
}


// send message to the queue with 0 offset to start data collecting tires first, wheels next
export async function startCollecting(env: Env): Promise<Response> {
    const exisitngState = await getSystemState(env);

    if (exisitngState?.status === 'Collecting' || exisitngState?.status === 'Updating') {
        return getResponse('Another process is in progress');
    }

    const sessionId = Date.now();

    const initialMessage: TRawQueueMessage = {
        type: 'tires',
        action: 'collect',
        offset: 0,
        sessionId
    };

    const state: TSystemState = {
        ...EMPTY_SYSTEM_STATE,
        status: 'Collecting',
        lastSessionId: sessionId
    };

    await updateSystemState(state, env);
    await env.MODELS_AGGREGATION_FETCH_QUEUE.send(JSON.stringify(initialMessage));
    return getResponse('Processing started');
}

// send message to the queue with 0 offset to start data updating tires first, wheels next
export async function startUpdating(env: Env): Promise<Response> {
    const exisitngState = await getSystemState(env);

    if (exisitngState?.status === 'Collecting' || exisitngState?.status === 'Updating') {
        return getResponse('Another process is in progress');
    }

    // await env.PRODUCTS_AGGREGATION_KV.put(LAST_UPDATE_KV_KEY, '2023-03-06T16:04:38Z');
    const lastUpdate = await env.PRODUCTS_AGGREGATION_KV.get(LAST_UPDATE_KV_KEY);
    const sessionId = Date.now();
    const initialMessage: TRawQueueMessage = {
        type: 'tires',
        action: 'update',
        offset: 0,
        lastUpdate: lastUpdate || '',
        sessionId
    };

    const state: TSystemState = {
        ...EMPTY_SYSTEM_STATE,
        status: 'Updating',
        lastSessionId: sessionId
    };

    await updateSystemState(state, env);
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

    // env.AK_PRODUCTS_D1.prepare(`INSERT OR REPLACE INTO wheelRebates (
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

// Remove session data, redirect to login page
export async function handleLogout(env: Env, extra: { request: Request; }) {
    console.log('HANDLE LOGOUT');

    await logout(extra.request, env);

    const response = new Response(null, {
        status: 301,
        headers: {
            'Location': '/login',
        }
    });
    return response;
}

// set correctponsing system state; redirect to home page
export async function stopProcessing(env: Env) {
    const currentState: TSystemState = await getSystemState(env) || EMPTY_SYSTEM_STATE;

    const newState: TSystemState = { ...currentState, status: 'Stopped' };
    await updateSystemState(newState, env);

    return new Response(null, {
        status: 301,
        headers: {
            'Location': '/'
        }
    });
}

// (re)initialize database
export async function initializeDatabase(env: Env): Promise<Response> {
    try {
        const { results } = await env.AK_PRODUCTS_D1.prepare(initTablesStmt)
            .all();
        return getResponse('initialized ' + JSON.stringify(results));
    } catch (e) {
        console.log(e);

        return new Response('Unable to init database, ' + e);
    }
}