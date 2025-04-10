import { parse } from 'cookie';

const SESSION_LIFETIME = 1000 * 60 * 60; // 1 hour

type TSession = {
    userName: string;
    expiresAt: number;
};

type TSessionData = {
    parsedData: TSession | null;
    session: string | null;
}

type TUserData = {
    password: string;
    session?: string;
};

export const FREE_ACCESS_ROUTES = [
    '/login',
    '/register'
];

export const PROTECTEDR_ROUTES = [
    '/start',
    '/stop',
    '/init',
    '/update',
    '/preview',
    '/logout',
    '/test-aggregation',
    '/'
];
export async function getNewSession(request: Request, env: Env): Promise<string | null> {
    const {session, parsedData} = await getSessionDataByRequest(request, env);

    if (!session || !parsedData) {
        return null;
    }

    const { userName, expiresAt } = parsedData;
    

    const storedUser = await getUserByName(userName, env);

    if (storedUser?.session !== session) {
        // invalid session
        return null;
    }

    if (expiresAt > Date.now() + SESSION_LIFETIME) {
        // outdated session
        return null;
    }

    const newSession = await getUpdatedSession(userName, env);
    await updateUserData(userName, { ...storedUser, session: newSession }, env);

    return newSession;

}

export async function login(name: string, password: string, env: Env): Promise<string | null> {
    const sanitizedName = name.trim().toLowerCase();
    const userData: TUserData | null = await getUserByName(sanitizedName, env);
    const passwordHash = await hashPasswrod(password);
    if (!userData || passwordHash !== userData.password) {
        throw Error('Invalid username or password');
    }

    const sessionObj: TSession = {
        userName: sanitizedName,
        expiresAt: Date.now() + SESSION_LIFETIME
    };

    const session = await encryptSession(sessionObj, env);

    try {
        await updateUserData(sanitizedName, { ...userData, session }, env);

        return session;
    } catch (e) {
        console.log('ERROR: Unable to save session', e);
        return null;
    }
}

export async function logout(request: Request, env: Env) {
    console.log('LOG OUT!!!!!');
    try {
        const { parsedData } = await getSessionDataByRequest(request, env);
        if (!parsedData) {
            throw Error('ERROR: Invalid session format');
        }

        const savedUserData = await getUserByName(parsedData.userName, env);

        if (!savedUserData) {
            throw Error('ERROR: No user, matching the session');
        }

        const {session, ...userDataWithoutSession} = savedUserData;
        await updateUserData(parsedData.userName, userDataWithoutSession, env);
    } catch(e) {

    }
}

export async function register(name: string, password: string, env: Env): Promise<void> {
    const sanitizedName = name.trim().toLowerCase();
    const passwordHash = await hashPasswrod(password);
    try {
        const body = {
            password: passwordHash.toString(),
        };
        await updateUserData(sanitizedName, body, env);
    } catch (e) {
        console.log('ERROR: Unable to register user', e);
        throw e;
    }
}

export function validateName(name: string): String | null {
    const nameMin = 4;
    const nameMax = 15;
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
        return 'Name is required';
    }

    if (trimmedName.length < nameMin) {
        return 'Name min length is ' + nameMin;
    }
    if (trimmedName.length > nameMax) {
        return 'Name max length is ' + nameMax;
    }

    return null;
}

export async function checkIfNameAlreadyRegistered(name: string, env: Env): Promise<string | null> {
    const data = await getUserByName(name, env);

    if (!!data) {
        return 'Name is already registered';
    }

    return null;
}

export function validatePassword(password: string, passwordConfirmation?: string): string | null {
    const passwordMin = 5;
    const passwordMax = 20;

    if (password.length === 0) {
        return 'Password is required';
    }

    if (password.length < passwordMin) {
        return 'Password min length is ' + passwordMin;
    }

    if (password.length > passwordMax) {
        return 'Password max length is ' + passwordMax;
    }

    if (passwordConfirmation && password !== passwordConfirmation) {
        return 'Passwords do not match';
    }

    return null;
};

export async function hashPasswrod(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const arrayBuffer = await crypto.subtle.digest("SHA-256", data);
    // const decoder = new TextDecoder()
    return buf2hex(arrayBuffer);

    function buf2hex(buffer: ArrayBuffer): string {
        return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
    }
}

export async function encryptSession(sessionObject: TSession, env: Env): Promise<any> {

    const key = env.ENCRYPTION_KEY
    const iv = env.ENCRYPTION_IV;

    const stringifiedSessionObject = JSON.stringify(sessionObject);
    const encodedText = new TextEncoder().encode(stringifiedSessionObject);

    const secretKey = await crypto.subtle.importKey('raw', Buffer.from(key, 'base64'), {
        name: 'AES-GCM',
        length: 256
    }, true, ['encrypt', 'decrypt']);

    const encriptedSession = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv: Buffer.from(iv, 'base64')
    }, secretKey, encodedText);

    return Buffer.from(encriptedSession).toString('base64');
}

export async function decryptSession(session: string, env: Env): Promise<TSession | null> {
    try {
        const secretKey = await crypto.subtle.importKey(
            'raw',
            Buffer.from(env.ENCRYPTION_KEY, 'base64'), 
            {
            name: 'AES-GCM',
            length: 256
        }, true, ['encrypt', 'decrypt']);
    
        const decryptedSession = await crypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: Buffer.from(env.ENCRYPTION_IV, 'base64'),
        }, secretKey, Buffer.from(session, 'base64'));
    
        const decodedSession = new TextDecoder().decode(decryptedSession);
      
        return JSON.parse(decodedSession);
    } catch (e) {
        console.log('ERROR: Unable to decrypt session ' + e);
        return null;
    }
}

async function getUserByName(name: string, env: Env): Promise<TUserData | null> {
    const userData = await env.PRODUCTS_AGGREGATION_KV.get(name);
    if (!userData) {
        return null;
    }
    try {
        const parsedUserData = JSON.parse(userData);
        return parsedUserData;
    } catch (e) {
        console.log('ERROR: Unable to parse user data', e);
        return null;

    }
}

async function getUpdatedSession(name: string, env: Env) {
    const newSessionObj: TSession = {
        userName: name,
        expiresAt: Date.now() + SESSION_LIFETIME,
    };

    return await encryptSession(newSessionObj, env);
}

async function updateUserData(name: string, userData: TUserData, env: Env) {
    await env.PRODUCTS_AGGREGATION_KV.put(name, JSON.stringify( userData ));
}

async function getSessionDataByRequest(request: Request, env: Env): Promise<TSessionData> {
    const sessionData: TSessionData = {
        parsedData: null,
        session: null,
    }
    const cookies = parse(request.headers.get('Cookie') || '');
    sessionData.session = cookies.session || null;

    if (!sessionData.session) {
        console.log('no session cookie');
        
        return sessionData;
    }

    sessionData.parsedData = await decryptSession(sessionData.session, env);

    if (!sessionData.parsedData) {
        console.log('no session');
        return sessionData;
    }

    return sessionData;
}