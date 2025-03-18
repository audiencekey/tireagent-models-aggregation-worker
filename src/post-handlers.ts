import { checkIfNameAlreadyRegistered, login, register, validateName, validatePassword } from './auth';
import { showLoginPage, showRegisterPage } from './get-handlers';

export async function handleLogin(request: Request, env: Env) {
    const {name, password} = await readPostBody(request);
    
    const errors: string[] = [];
    if (!name?.length) {
        errors.push('Name is required');
    }

    if (!password?.length) {
        errors.push('Password is required');
    }

    if (errors.length) {
        return showLoginPage(env, {errors})
    }

    try {
        const session = await login(name, password, env);

        if (!session) {
            return showLoginPage(env, {errors: ['Server error. Try again later']})
        }
        console.log('Logging in with session ' + session);
        
        return new Response(null, {
            status: 301,
            headers: {
                'Location': '/',
		        'Set-Cookie': `session=${session}; secure; HttpOnly; SameSite=Strict;`
            }
        })
    } catch(e) {
        errors.push((e as Error).message);
        return showLoginPage(env, {errors})
    }
}

export async function handleRegister(request: Request, env: Env) {
    const { name, password, confirmPassword } = await readPostBody(request);
    
    const errors = [
        validateName(name),
        await checkIfNameAlreadyRegistered(name, env),
        validatePassword(password, confirmPassword)
    ].filter(v => !!v);

    if (errors.length) {
        return showRegisterPage(env, { errors: errors as string[], name })
    }

    await register(name, password, env);
    const origin = new URL(request.url).origin;
    const loginUrl = origin + '/login?registered=true';
    return new Response(null, {
        status: 301,
        headers: {
            'Location': loginUrl
        }
    });
}

async function readPostBody(request: Request): Promise<Record<string, any>> {
    const formData = await request.formData()
    const body: Record<string, any> = {};
    for (const entry of formData.entries()) {
        body[entry[0]] = entry[1];
    }

    return body;
    
}