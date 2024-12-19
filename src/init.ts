export const initTablesStmt = `
PRAGMA foreign_keys = on;
PRAGMA defer_foreign_keys = on;
DROP TABLE IF EXISTS Brands;
CREATE TABLE IF NOT EXISTS Brands (
    brandId INTEGER PRIMARY KEY AUTOINCREMENT, 
    brandName TEXT
);
    
DROP TABLE IF EXISTS Models;
CREATE TABLE IF NOT EXISTS Models (
    modelId INTEGER PRIMARY KEY AUTOINCREMENT, 
    modelName TEXT, 
    modelTaxonId TEXT,
    brandId INTEGER,
    FOREIGN KEY(BrandId) REFERENCES Brands(brandId)
);

DROP TABLE IF EXISTS Products;
CREATE TABLE IF NOT EXISTS Products (
    productId INTEGER PRIMARY KEY AUTOINCREMENT, 
    availability TEXT,
    currency TEXT,
    description TEXT,
    dualLoadIndex INTEGER,
    dualMaxInflationPressure INTEGER,
    dualMaxLoad INTEGER,
    featured boolean,
    id TEXT,
    imageUrl TEXT,
    loadIndex INTEGER,
    maxInflationPressure INTEGER,
    maxLoad INTEGER,
    mpn TEXT,
    overallDiameter FLOAT,
    price FLOAT,
    revsPerMile INTEGET,
    rimWidthRange TEXT,
    roadCondition TEXT,
    sectWidth FLOAT,
    sidewall TEXT,
    sizeDesc TEXT,
    sku TEXT,
    speedRating TEXT,
    temperature TEXT,
    traction TEXT,
    treadDepth FLOAT,
    treadType TEXT,
    treadwear TEXT,
    url TEXT,
    utqg TEXT,
    warranty TEXT,
    aspectRatio FLOAT,
    diameter FLOAT,
    width FLOAT,
    modelId INTEGER,
    FOREIGN KEY(ModelID) REFERENCES Models(modelId)
);
PRAGMA defer_foreign_keys = off;`