import { 
    addBulkBrands, 
    addBulkModels, 
    addBulkRebates, 
    bulkDeleteProductsById, 
    checkAndDeleteRebates, 
    fetchItemsFromAPI, 
    getCurrentTime, 
    recursiveExecute, 
    TModel, 
    TRebate 
} from './common';

type TTireProduct = {
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
    };
    rebate: { id: number; } | null;
};

type TTiresFetchData = {
    items: TTireProduct[];
    hasNextPage: boolean;
    totalItems: number;
};

// fetch and process chunk of tires data due to given offset
// returns true if more tires still available to fetch from API
export async function collectTires(offset: number, limit: number, env: Env): Promise<boolean | null> {
    if (offset === 0) {
        await processTireRebates(env);
    }
    console.log(`${getCurrentTime()} Collecting tires with offset ${offset}`);
    const { items, hasNextPage, totalItems } = await fetchTires(offset, limit, env);
    
    const brandNames = new Set<string>();
    const models: Record<string, TModel> = {};

    for (let item of items) {
        brandNames.add(item.brand);
        models[item.modelName] = {
            modelName: item.modelName,
            brandName: item.brand,
            // skip modelTaxonId property for tires since API fails to return some products with that specific property
            modelTaxonId: 'unset'
        };
    }

    await recursiveExecute(Array.from(brandNames), env, 'tires', addBulkBrands);
    await recursiveExecute(Object.values(models), env, 'tires', addBulkModels);

    for (let item of items) {
        const res = await addTireProduct(item, env);
        if (!res) {
            return null;
        }
    }

    console.log(`${getCurrentTime()} Processed ${offset + items.length} tires out of ${totalItems}`);

    return hasNextPage;
}

// fetch and save to the D1 DB all tire rebates
export async function processTireRebates(env: Env, shouldCheckDeleted?: boolean): Promise<void> {
    console.log(getCurrentTime(), 'Processing tire rebates');

    type TRebatesResponse = {
        data: {
            tireDeals: TRebate[];
        };
    };

    let rebates: TRebate[] = [];

    const query = `
        query TireDeals {
            tireDeals {
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
    try {
        const { data }: TRebatesResponse = await fetchItemsFromAPI(query, env);

        rebates = data.tireDeals;
    } catch (e) {
        console.log(getCurrentTime(), 'Unable to fetch tire rebates');
    }

    if (shouldCheckDeleted) {
        await checkAndDeleteRebates(rebates, 'tires', env)
    }

    if (!rebates?.length) {
        return;
    }

    await recursiveExecute(rebates, env, 'tires', addBulkRebates);

    console.log(`${getCurrentTime()} Saved ${rebates.length} tire rebates`);

}

// fetch and update in the D1 DB tire product data due to given offset and lastUpdate date
export async function updateTires(offset: number, limit: number, env: Env, lastUpdateDate: string | null): Promise<boolean | null> {
    console.log(`${getCurrentTime()} Updating tires with offset ${offset} and updateDate ${lastUpdateDate}`);

    if (!lastUpdateDate) {
        return null;
    }
    if (offset === 0) {
        await processTireRebates(env, true);
    }
    
    const { items, hasNextPage, totalItems }: TTiresFetchData = await fetchTires(offset, limit, env, 0, lastUpdateDate);
    
    for (let item of items) {
        const res = await addTireProduct(item, env);
        if (!res) {
            return null;
        }
    }
    console.log(`${getCurrentTime()} Updated ${offset + items.length} tires out of ${totalItems}, changed after ${lastUpdateDate}`);

    return hasNextPage
}

export async function deleteTires(offset: number, limit: number, env: Env, lastUpdateDate: string | null): Promise<boolean | null> {
    console.log(`${getCurrentTime()} Deleting tires with offset ${offset} and updateDate ${lastUpdateDate}`);

    if (!lastUpdateDate) {
        return null;
    }

    const { items, hasNextPage, totalItems }: TTiresFetchData = await fetchTires(offset, limit, env, 0, lastUpdateDate, true);
    
    const deletedTireIds = items.map(tire => tire.id);

    await recursiveExecute(deletedTireIds, env, 'tires', bulkDeleteProductsById)

    console.log(`${getCurrentTime()} Deleted ${offset + items.length} tires out of ${totalItems}, changed after ${lastUpdateDate}`);

    return hasNextPage;
}

// fetch data from the API by given offset
export async function fetchTires(offset: number, limit: number, env: Env, attemptNumber = 0, lastUpdatedDate?: string, deleted?: boolean): Promise<TTiresFetchData> {
    const maxAttempts = 3;
    type TTiresResponse = {
        data: {
            allTires: {
                items: TTireProduct[],
                pageInfo: {
                    hasNextPage: boolean,
                    totalCount: number;
                };
            };
        };
    };
    let queryArguments = `limit: ${limit}, offset: ${offset}`;

    if (lastUpdatedDate) {
        queryArguments += `, updatedAfter: "${lastUpdatedDate}"`;
    }

    if (deleted) {
        queryArguments += `, deleted: true`
    }

    const query = `query AllTires {
        allTires(${queryArguments}) {
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
                rebate {
                    id
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
        const response: TTiresResponse = await fetchItemsFromAPI<TTiresResponse>(query, env);
        const { items, pageInfo: { hasNextPage, totalCount } } = response.data.allTires;
        return {
            items,
            hasNextPage,
            totalItems: totalCount
        };
    } catch (e) {
        console.log(`${getCurrentTime()} Unable to fetch tires with offset ${offset}`, e);
        console.log(query);
        if (attemptNumber < maxAttempts) {
            const newAttemptNumber = attemptNumber + 1;
            console.log(`${getCurrentTime()} Attempt ${newAttemptNumber}`);

            return await fetchTires(offset, limit, env, newAttemptNumber);
        }

        return {
            items: [],
            hasNextPage: false,
            totalItems: 0
        };
    }
}

// add new product to the D1 database
async function addTireProduct(productData: TTireProduct, env: Env): Promise<boolean> {
    const query = `
    INSERT OR REPLACE INTO TireProducts (
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
			modelName,
			brandName,
            rebateId
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
	`;

    const values = [
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
        productData.modelName,
        productData.brand,
        productData.rebate?.id || null
    ];

    try {

        await env.MODELS_AGGREGATION_DB.prepare(query)
            .bind(...values)
            .run();
        return true;
    } catch (e) {
        console.log(`${getCurrentTime()} Unable to process item ${productData}`);
        console.log(e);
        console.log(query);
        console.log(values);

        return false;
    }
}