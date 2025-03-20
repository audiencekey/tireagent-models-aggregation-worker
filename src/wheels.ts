import {
    addBulkBrands,
    addBulkModels,
    addBulkRebates,
    fetchItemsFromAPI,
    getCurrentTime,
    recursiveExecute,
    TModel,
    TRebate,
    checkAndDeleteRebates,
    bulkDeleteProductsById,
    asyncDelay,
    TSystemState,
    getSystemState,
    EMPTY_SYSTEM_STATE,
    updateSystemState
} from './common';

export type TWheelProduct = {
    availability: string;
    backSpacing: number;
    boltCircle: number;
    brand: string;
    currency: string;
    featured: boolean;
    finish: string;
    hubBore: number;
    id: string;
    imageUrl: string;
    length: number;
    lugs: number;
    modelName: string;
    offset: number;
    price: number;
    url: string;
    weight: number;
    size: {
        boltPattern: string;
        diameter: number;
        width: number;
    };
    rebate: { id: number; } | null;
};

type TWheelsFetchData = {
    items: TWheelProduct[];
    hasNextPage: boolean;
    totalItems: number;
};

export async function collectWheels(offset: number, limit: number, env: Env): Promise<boolean> {
    if (offset === 0) {
        await processWheelRebates(env);
    }

    console.log(`${getCurrentTime()} Collecting wheels with offset ${offset}`);
    const { items, hasNextPage, totalItems } = await fetchWheels(offset, limit, env);

    const brandNames = new Set<string>();
    const models: Record<string, TModel> = {};

    for (let item of items) {
        brandNames.add(item.brand);
        // none instead of modelTaxonId since API doesn't return that value for allWheels query
        models[item.modelName] = {
            modelName: item.modelName,
            brandName: item.brand,
            modelTaxonId: 'none'
        };
    }
    
    // Need delay between different entities save due to D1 save lag.
    await recursiveExecute(Array.from(brandNames), env, 'wheels', addBulkBrands);
    await asyncDelay(1000);
    await recursiveExecute(Object.values(models), env, 'wheels', addBulkModels);
    await asyncDelay(1000);

    for (let item of items) {
        await addWheelProduct(item, env);
    }

    console.log(`${getCurrentTime()} Collected ${offset + items.length} wheels out of ${totalItems}`);
    const currentState: TSystemState = (await getSystemState(env) || EMPTY_SYSTEM_STATE);
        const newState: TSystemState = {
            ...currentState,
            status: currentState.status === 'Stopped' ? 'Stopped' : 'Collecting',
            wheelsProcessed: offset + items.length,
            wheelsTotal: totalItems
        }
    
        await updateSystemState(newState, env);

    return hasNextPage;
}

// fetch and save to the D1 DB all wheel rebates
export async function processWheelRebates(env: Env, shouldCheckDeleted?: boolean): Promise<void> {
    console.log(getCurrentTime(), 'Processing wheel rebates');

    type TRebatesResponse = {
        data: {
            wheelDeals: TRebate[];
        };
    };
    const query = `
        query WheelDeals {
            wheelDeals {
                brandId
                detailedDescription
                expiresAt
                id
                img
                instantRebate
                name
                price
                shortDescription
                startsAt
                submissionDate
                submissionLink
                title
            }
        }
    `;

    let rebates: TRebate[] = [];
    try {
        const { data }: TRebatesResponse = await fetchItemsFromAPI(query, env);

        rebates = data.wheelDeals;
    } catch (e) {
        console.log(getCurrentTime(), 'Unable to fetch wheel rebates');
    }

    if (shouldCheckDeleted) {
        await checkAndDeleteRebates(rebates, 'wheels', env);
    }

    if (!rebates?.length) {
        return;
    }

    await recursiveExecute(rebates, env, 'wheels', addBulkRebates);

    console.log(`${getCurrentTime()} Saved ${rebates.length} wheel rebates`);

}

// fetch and update in the D1 DB wheel product data due to given offset and lastUpdate date
export async function updateWheels(offset: number, limit: number, env: Env, lastUpdateDate: string | null): Promise<boolean | null> {
    console.log(`${getCurrentTime()} Updating wheels with offset ${offset} and updateDate ${lastUpdateDate}`);

    if (!lastUpdateDate) {
        return null;
    }
    if (offset === 0) {
        await processWheelRebates(env, true);
    }

    const { items, hasNextPage, totalItems }: TWheelsFetchData = await fetchWheels(offset, limit, env, 0, lastUpdateDate);

    for (let item of items) {
        const res = await addWheelProduct(item, env);
        if (!res) {
            return null;
        }
    }

    console.log(`${getCurrentTime()} Updated ${offset + items.length} wheels out of ${totalItems}, changed after ${lastUpdateDate}`);

    const currentState: TSystemState = (await getSystemState(env) || EMPTY_SYSTEM_STATE);
    const newState: TSystemState = {
        ...currentState,
        status: currentState.status === 'Stopped' ? 'Stopped' : 'Updating',
        wheelsProcessed: offset + items.length,
        wheelsTotal: totalItems
    }

    await updateSystemState(newState, env);

    return hasNextPage;
}

export async function deleteWheels(offset: number, limit: number, env: Env, lastUpdateDate: string | null): Promise<boolean | null> {
    console.log(`${getCurrentTime()} Deleting wheels with offset ${offset} and updateDate ${lastUpdateDate}`);

    if (!lastUpdateDate) {
        return null;
    }

    const { items, hasNextPage, totalItems }: TWheelsFetchData = await fetchWheels(offset, limit, env, 0, lastUpdateDate, true);

    const deletedWheelIds = items.map(wheel => wheel.id);

    await recursiveExecute(deletedWheelIds, env, 'wheels', bulkDeleteProductsById);

    console.log(`${getCurrentTime()} Deleted ${offset + items.length} wheels out of ${totalItems}, changed after ${lastUpdateDate}`);

    const currentState: TSystemState = (await getSystemState(env) || EMPTY_SYSTEM_STATE);
    const newState: TSystemState = {
        ...currentState,
        status: currentState.status === 'Stopped' ? 'Stopped' : 'Updating',
    }

    await updateSystemState(newState, env);
    
    return hasNextPage;
}

// fetch data from the API by given offset
export async function fetchWheels(offset: number, limit: number, env: Env, attemptNumber = 0, lastUpdatedDate?: string, deleted?: boolean): Promise<TWheelsFetchData> {
    type TAllWheelsResponse = {
        data: {
            allWheels: {
                items: TWheelProduct[],
                pageInfo: {
                    hasNextPage: boolean,
                    totalCount: number;
                };
            };
        };
    };

    const maxAttempts = 3;

    let queryArguments = `limit: ${limit}, offset: ${offset}`;

    if (lastUpdatedDate) {
        queryArguments += `, updatedAfter: "${lastUpdatedDate}"`;
    }

    if (deleted) {
        queryArguments += `, deleted: true`;
    }

    const query = `query AllWheels {
        allWheels(${queryArguments}) {
            items {
                availability
                backSpacing
                boltCircle
                brand
                currency
                featured
                finish
                hubBore
                id
                imageUrl
                length
                lugs
                modelName
                offset
                price
                url
                weight
                size {
                    boltPattern
                    diameter
                    width
                }
                rebate {
                    detailedDescription
                    expiresAt
                    id
                    img
                    instantRebate
                    models
                    name
                    price
                    shortDescription
                    startsAt
                    submissionDate
                    submissionLink
                }
            }
            pageInfo {
                hasNextPage
                limit
                offset
                totalCount
            }
        }
    }`;

    try {
        const response: TAllWheelsResponse = await fetchItemsFromAPI<TAllWheelsResponse>(query, env);
        const { items, pageInfo: { hasNextPage, totalCount } } = response.data.allWheels;
        return {
            items,
            hasNextPage,
            totalItems: totalCount
        };
    } catch (e) {
        console.log(`${getCurrentTime()} Unable to fetch wheels with offset ${offset}`, e);
        console.log(query);
        if (attemptNumber < maxAttempts) {
            const newAttemptNumber = attemptNumber + 1;
            console.log(getCurrentTime(), 'Attempt' + newAttemptNumber);

            return await fetchWheels(offset, limit, env, newAttemptNumber);
        }

        return {
            items: [],
            hasNextPage: false,
            totalItems: 0
        };
    }
}

async function addWheelProduct(productData: TWheelProduct, env: Env) {
    const query = `
		INSERT OR REPLACE INTO WheelProducts (
			availability,
            backSpacing,
            boltCircle,
            currency,
            featured,
            finish,
            hubBore,
            id,
            imageUrl,
            length,
            lugs,
            offset,
            price,
            url,
            weight,
            boltPattern,
            diameter,
            width,
            brandName,
            modelName,
            rebateId
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
	`;

    const values = [
        productData.availability,
        productData.backSpacing,
        productData.boltCircle,
        productData.currency,
        productData.featured,
        productData.finish,
        productData.hubBore,
        productData.id,
        productData.imageUrl,
        productData.length,
        productData.lugs,
        productData.offset,
        productData.price,
        productData.url,
        productData.weight,
        productData.size.boltPattern,
        productData.size.diameter,
        productData.size.width,
        productData.brand,
        productData.modelName,
        productData.rebate?.id || null
    ];

    try {
        await env.MODELS_AGGREGATION_DB.prepare(query)
            .bind(...values)
            .run();

        return true;
    } catch (e) {
        console.log(getCurrentTime(), 'Unable to save product', productData);
        console.log(e);
        console.log(query);

        return false;
    }

    // console.log('Product' + productData.id + ' added');
}