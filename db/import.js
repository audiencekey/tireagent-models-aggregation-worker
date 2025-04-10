const { exec } = require('child_process');
const fs = require('fs');
const readline = require('readline');

const INSERTS_PER_CHUNK = 1500;

async function splitToChunks() {
    //   const fileStream = fs.createReadStream('database.sql');
    const fileStream = fs.createReadStream('database.sql');

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    let insertsCounter = 0;
    let chunksCounter = 0;
    let writer = await getWriter(chunksCounter);

    for await (const line of rl) {
        const isInsert = line.startsWith('INSERT INTO');
        if (insertsCounter >= INSERTS_PER_CHUNK || (!isInsert && insertsCounter > 0)) {
            writer.end();
            chunksCounter++;
            insertsCounter = 0;
            writer = await getWriter(chunksCounter);
        }
        if (line.startsWith('INSERT INTO')) {
            insertsCounter++;
        }
        await writeLine(writer, line);
    }

    console.log(`Split to chunks finished, ${chunksCounter} chunks generated`);

}

async function writeLine(_writer, line) {
    new Promise(resolve => {
        _writer.write(line + '\n', () => {
            resolve();
        })
    })
}

async function getWriter(number) {
    console.log('Writing chunk ' + number);

    const writerStream = fs.createWriteStream(`${number}-chunk.sql`, { flags: 'a' });

    return new Promise(resolve => {
        writerStream.on('open', () => resolve(writerStream));
    })
}

async function importChunks() {
    const allFiles = fs.readdirSync('.');
    const allChunks = allFiles.filter(file => file.endsWith('-chunk.sql'));
    const sortedChunks = allChunks.sort((a, b) => {
        const aNum = +a.split('-')[0];
        const bNum = +b.split('-')[0];

        return aNum - bNum;
    })
    console.log('Import started');

    for (let file of sortedChunks) {
        try {
            console.log('Importing ' + file);
            await execAsync(`cd ../ && npx wrangler d1 execute AK_PRODUCTS_D1 --local --file=./db/${file}`)
        } catch (e) {
            console.log('ERROR: Unable to import data from file ' + file, e);
            break;
        }
    }
    console.log('Import completed');
    console.log('Removing temp files');

    execAsync(`find . -name '*-chunk.sql' -delete`);
    execAsync('rm database.sql');
    console.log('You are ready to go');

}

async function execAsync(command) {
    const child = exec(command, (err, output, errOutput) => {
        if (err) {
            console.log('ERROR: ', err, errOutput);
        }
    });
    return new Promise(resolve => {
        child.on('exit', () => {
            resolve();
        });
    });
}

async function importDB() {
    await splitToChunks();
    await importChunks();
}

importDB();