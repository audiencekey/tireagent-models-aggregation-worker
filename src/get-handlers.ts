import { logout } from './auth';
import { getAllEntriesFromDbByQuery, getResponse, LAST_UPDATE_KV_KEY, renderList, TRawQueueMessage, updateLastUpdatedDate } from './common';

// show static page with base info
export async function showHomePage(): Promise<Response> {
    return Promise.resolve(getResponse(`
        <h1>
            Initialize DB before previewing or processing.<br/>
            WARNING!!! all existing data will be deleted pemanently!
        </h1>
    `));
}

export async function showLoginPage(env: Env, extra?: {errors?: string[], clearCookies?: boolean, name?: string, params?: URLSearchParams}): Promise<Response> {
    const hasRegisteredMessage = !!extra?.params?.get('registered')
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
    }))
}

export function showRegisterPage(env: Env, extra: {errors?: string[], name?: string, params?: URLSearchParams}): Promise<Response> {
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
    `

    const errors = extra?.errors || [];

    if (errors?.length) {
        errors.forEach(error => pageContent += `<div>${error}</div>`);
    }

    return Promise.resolve(new Response(pageContent, {
        headers: {
            'Content-Type': 'text/html'
        }
    }))
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

	updateLastUpdatedDate(env);

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


export async function handleLogout(env: Env, extra: {request: Request}) {
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