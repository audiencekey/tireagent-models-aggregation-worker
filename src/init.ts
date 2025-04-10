export const initTablesStmt = `
PRAGMA foreign_keys = on;
PRAGMA defer_foreign_keys = on;
DROP TABLE IF EXISTS TireBrands;
CREATE TABLE IF NOT EXISTS TireBrands (
    brandId INTEGER PRIMARY KEY AUTOINCREMENT, 
    brandName TEXT UNIQUE NOT NULL
);
    
DROP TABLE IF EXISTS TireModels;
CREATE TABLE IF NOT EXISTS TireModels (
    modelId INTEGER PRIMARY KEY AUTOINCREMENT, 
    modelName TEXT UNIQUE NOT NULL, 
    modelTaxonId TEXT,
    brandName TEXT,
    FOREIGN KEY(BrandName) REFERENCES TireBrands(brandName)
);

DROP TABLE IF EXISTS TireRebates;
CREATE TABLE IF NOT EXISTS TireRebates (
    rebateId INTEGER PRIMARY KEY AUTOINCREMENT, 
    brandId INTEGER NOT NULL,
    detailedDescription TEXT,
    expiresAt TEXT,
    id TEXT UNIQUE NOT NULL,
    img TEXT,
    instantRebate BOOLEAN,
    name TEXT,
    price FLOAT,
    shortDescription TEXT,
    startsAt TEXT,
    submissionDate TEXT,
    submissionLink TEXT,
    title TEXT
);

DROP TABLE IF EXISTS TireProducts;
CREATE TABLE IF NOT EXISTS TireProducts (
    productId INTEGER PRIMARY KEY AUTOINCREMENT, 
    availability TEXT,
    currency TEXT,
    description TEXT,
    dualLoadIndex INTEGER,
    dualMaxInflationPressure INTEGER,
    dualMaxLoad INTEGER,
    featured BOOLEAN,
    id TEXT UNIQUE NOT NULL,
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
    brandName TEXT,
    modelName TEXT,
    rebateId TEXT,
    FOREIGN KEY(modelName) REFERENCES TireModels(modelName),
    FOREIGN KEY(brandName) REFERENCES TireBrands(brandName),
    CONSTRAINT fk_column
        FOREIGN KEY(rebateId)
        REFERENCES TireRebates(id)
        ON DELETE SET NULL
);

DROP TABLE IF EXISTS WheelBrands;
CREATE TABLE IF NOT EXISTS WheelBrands (
    brandId INTEGER PRIMARY KEY AUTOINCREMENT, 
    brandName TEXT UNIQUE NOT NULL
);
    
DROP TABLE IF EXISTS WheelModels;
CREATE TABLE IF NOT EXISTS WheelModels (
    modelId INTEGER PRIMARY KEY AUTOINCREMENT, 
    modelName TEXT UNIQUE NOT NULL, 
    modelTaxonId TEXT,
    brandName TEXT,
    FOREIGN KEY(brandName) REFERENCES WheelBrands(brandName)
);

DROP TABLE IF EXISTS WheelRebates;
CREATE TABLE IF NOT EXISTS WheelRebates (
    rebateId INTEGER PRIMARY KEY AUTOINCREMENT, 
    brandId INTEGER NOT NULL,
    detailedDescription TEXT,
    expiresAt TEXT,
    id TEXT UNIQUE NOT NULL,
    img TEXT,
    instantRebate BOOLEAN,
    name TEXT,
    price FLOAT,
    shortDescription TEXT,
    startsAt TEXT,
    submissionDate TEXT,
    submissionLink TEXT,
    title TEXT
);

DROP TABLE IF EXISTS WheelProducts;
CREATE TABLE IF NOT EXISTS WheelProducts (
    availability TEXT,
    backSpacing FLOAT,
    boltCircle FLOAT,
    currency TEXT,
    featured BOOLEAN,
    finish TEXT,
    hubBore FLOAT,
    id TEXT UNIQUE NOT NULL,
    imageUrl TEXT,
    length FLOAT,
    lugs INTEGER,
    offset INTEGER,
    price FLOAT,
    url TEXT,
    weight FLOAT,
    boltPattern TEXT,
    diameter FLOAT,
    width FLOAT,
    brandName TEXT,
    modelName TEXT,
    rebateId TEXT,
    FOREIGN KEY(modelName) REFERENCES WheelModels(modelName),
    FOREIGN KEY(brandName) REFERENCES WheelBrands(brandName),
    CONSTRAINT fk_column
				FOREIGN KEY(rebateId)
				REFERENCES WheelRebates(id)
				ON DELETE SET NULL
);
PRAGMA defer_foreign_keys = off;`