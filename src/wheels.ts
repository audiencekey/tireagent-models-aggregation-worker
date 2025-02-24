import { addBulkBrands, addBulkModels, addBulkRebates, fetchItemsFromAPI, recursiveSave, TModel, TRebate } from './common';

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
    rebate: { id: number } | null;
};

type TWheelsFetchData = {
    items: TWheelProduct[];
    hasNextPage: boolean;
    totalItems: number;
};

export async function processWheels(offset: number, limit: number, env: Env): Promise<boolean> {
    if (offset === 0) {
        await processWheelRebates(env)
    }
    
    console.log('Processing wheels with offset ' + offset);
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

    await recursiveSave(Array.from(brandNames), env, 'wheels', addBulkBrands);
    await recursiveSave(Object.values(models), env, 'wheels', addBulkModels);

    for (let item of items) {
        await addWheelProduct(item, env);
    }

    console.log(`Processed ${offset + items.length} wheels out of ${totalItems}`);

    return hasNextPage;
}

// fetch and save to the D1 DB all tire rebates
export async function processWheelRebates(env: Env): Promise<void> {
    console.log('Processing tire rebates');
    
    type TRebatesResponse = {
        data: {
            wheelDeals: TRebate[]
        }
    }
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
        console.log('Unable to fetch wheel rebates');
    }
    
    if (!rebates?.length) {
        return;
    }

    await recursiveSave(rebates, env, 'wheels', addBulkRebates);

    console.log(`Saved ${rebates.length} wheel rebates`);
    
}

// fetch data from the API by given offset
export async function fetchWheels(offset: number, limit: number, env: Env, attemptNumber = 0): Promise<TWheelsFetchData> {
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

    const query = `query AllWheels {
        allWheels(limit: ${limit}, offset: ${offset}) {
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
        console.log(`Unable to fetch wheels with offset ${offset}`, e);
        console.log(query);
        if (attemptNumber < maxAttempts) {
            const newAttemptNumber = attemptNumber + 1;
            console.log('Attempt' + newAttemptNumber);
            
            return await fetchWheels(offset, limit, env, newAttemptNumber);
        }

        return {
            items: [],
            hasNextPage: false,
            totalItems: 0
        }
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
    } catch (e) {
        console.log('Unable to save product', productData);
        console.log(e);
        console.log(query);

    }

    // console.log('Product' + productData.id + ' added');
}