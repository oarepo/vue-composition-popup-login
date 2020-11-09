import _Vue from 'vue';
import {normalizeUrl} from './url';
import {reactive, Ref, ref} from '@vue/composition-api';
import {
    AuthenticationState,
    LoginMessage,
    LoginStateTransformer,
    Need,
    NoAccessNotifier,
    PopupFailedNotifier,
    PopupLoginPluginOptions,
    RouteMeta,
    UsePopupLoginOptions
} from './types';
import axios from 'axios'
import {isMatch} from 'lodash'

const DEFAULT_LOGIN_URL = '/auth/login';
const DEFAULT_COMPLETE_URL = '/auth/complete';
const DEFAULT_LOGOUT_URL = '/auth/logout';
const DEFAULT_STATE_URL = '/auth/state';
const DEFAULT_NEXT_QUERY_PARAM = 'next'

const loginOptions = reactive({
    loginUrl: null as any as string,
    logoutUrl: null as any as string,
    completeUrl: null as any as string,
    redirectionCompleteUrl: null as (string | null),
    stateUrl: null as any as string,
    nextQueryParam: null as any as string,
    loginStateTransformer: null as (LoginStateTransformer<AuthenticationState> | null),
    popupFailedNotifier: null as any as PopupFailedNotifier,
    noAccessNotifier: null as any as NoAccessNotifier
})

const loginData = reactive({
    channel: null as any,
    promises: [] as Array<(msg: LoginMessage) => void>,
})

const loginState = ref<AuthenticationState>({loggedIn: false, needsProvided: []})

/**
 * Provides access to the login state. The first time (in main.js or app's setup)
 * you call it, it will get initialized. Other times it will just return the initialized
 * copy.
 *
 * You can use it either the composition-style (that is, in setup() function call usePopupLogin
 * and use it there), or can use the provided Vue.use(popupLoginPlugin, {})
 *
 * @param loginUrl
 * @param logoutUrl
 * @param completeUrl
 * @param redirectionCompleteUrl
 * @param stateUrl
 * @param nextQueryParam
 * @param loginStateTransformer
 * @param popupFailedNotifier
 */
export function usePopupLogin<UserAuthenticationState extends AuthenticationState>(
    {
        loginUrl,
        logoutUrl,
        completeUrl,
        redirectionCompleteUrl,
        stateUrl,
        nextQueryParam,
        loginStateTransformer,
        popupFailedNotifier,
        noAccessNotifier
    }: UsePopupLoginOptions<UserAuthenticationState>) {
    if (!loginOptions.loginUrl) {
        loginOptions.loginUrl = loginUrl || DEFAULT_LOGIN_URL
        loginOptions.logoutUrl = logoutUrl || DEFAULT_LOGOUT_URL
        loginOptions.completeUrl = completeUrl || DEFAULT_COMPLETE_URL
        loginOptions.redirectionCompleteUrl = redirectionCompleteUrl || null
        loginOptions.stateUrl = stateUrl || DEFAULT_STATE_URL
        loginOptions.nextQueryParam = nextQueryParam || DEFAULT_NEXT_QUERY_PARAM
        loginOptions.loginStateTransformer = loginStateTransformer
        loginOptions.noAccessNotifier = noAccessNotifier
        loginOptions.popupFailedNotifier = popupFailedNotifier || (
            async () => {
                console.error('Could not create login popup window')
                return true
            }
        )
        loginData.channel = new BroadcastChannel('popup-login-channel');

        loginData.channel.onmessage = function(msg: LoginMessage) {
            const promises = loginData.promises
            loginData.promises = []

            async function notify() {
                for (const p of promises) {
                    await p(msg)
                }
            }
        }
    }

    function _handleFailedLoginPopup(reject: (reason?: any) => void) {
        loginOptions.popupFailedNotifier().then((redirectionOk) => {
            if (!redirectionOk) {
                reject('Could not open popup window and redirection has not been allowed')
            } else {
                const redirectionUrl = new URL(loginOptions.loginUrl, window.location.href)
                redirectionUrl.searchParams.append(
                    loginOptions.nextQueryParam,
                    loginOptions.redirectionCompleteUrl
                        ? normalizeUrl(loginOptions.redirectionCompleteUrl)
                        : window.location.href)
                window.location.href = redirectionUrl.toString()
                // no need to finish the promise as we are leaving the page
            }
        })
    }

    async function check(localStateSufficient = false): Promise<UserAuthenticationState> {
        if (loginState.value.loggedIn && localStateSufficient) {
            return loginState.value as UserAuthenticationState
        }
        const resp = await axios.get(loginOptions.stateUrl)
        if (loginOptions.loginStateTransformer) {
            loginState.value = loginOptions.loginStateTransformer(resp.data)
        } else {
            loginState.value = resp.data as AuthenticationState
        }
        return loginState.value as UserAuthenticationState
    }

    function login(): Promise<boolean> {
        // popup the login as soon as possible - that's why the function is not async
        const loginUrl = new URL(loginOptions.loginUrl, window.location.href)
        loginUrl.searchParams.append(loginOptions.nextQueryParam, normalizeUrl(loginOptions.completeUrl))
        const currentPopup = window.open(loginUrl.toString(), '_blank')
        return new Promise((resolve, reject) => {
            if (!currentPopup) {
                return _handleFailedLoginPopup(reject);
            }
            loginData.promises.splice(0, 0, () => check())
            loginData.promises.push((msg: LoginMessage) => {
                resolve(loginState.value.loggedIn)
            })
        })
    }

    async function showLoginPopup(extra: any) {
        return new Promise((resolve) => {
            loginData.promises.push(resolve)
            loginOptions.noAccessNotifier(loginState.value, extra)
        })
    }

    async function authorize(
        state: UserAuthenticationState,
        needsRequired: Need<UserAuthenticationState>[],
        needsProvided: Need<UserAuthenticationState>[],
        extra: any): Promise<boolean> {

        // sanity check
        needsProvided = needsProvided || []
        needsRequired = needsRequired || []

        // check if there is a requiredNeed that is contained in the provided needs
        // if there is at least one, the person is authorized
        for (const requiredNeed of needsRequired) {
            // if the required need is a string, look in all provided needs
            // if there is a string with the same value
            if (typeof requiredNeed === 'string') {
                if (needsProvided.indexOf(requiredNeed) >= 0) {
                    return true
                }
                // if the required need is a function, apply it and if it returns true,
                // consider the need to be fulfilled
            } else if (typeof requiredNeed === 'function') {
                if (await requiredNeed(state, needsProvided, extra)) {
                    return true
                }
                // if the need is an object, it must be contained in at least
                // one of the provided needs to be marked as fulfilled
            } else {
                if (needsProvided.some(n => {
                        if (typeof n === 'string' || typeof n === 'function') {
                            return false
                        }
                        return isMatch(n, requiredNeed)
                    }
                )) return true
            }
        }
        return false
    }

    async function loginAndAuthorize(needsRequired: Need<UserAuthenticationState>[], extra: any): Promise<boolean> {
        const authState = await check(true)
        if (!authState.loggedIn) {
            // register on login finished
            await showLoginPopup(extra)
            if (!loginState.value.loggedIn) {
                return false
            }
        }
        return authorize(authState, needsRequired, authState.needsProvided, extra)
    }

    return {
        options: loginOptions,
        loginState: loginState as Ref<UserAuthenticationState>,
        check,
        login,
        authorize,
        loginAndAuthorize
    }
}

/**
 * Vue plugin. Do not forget to call Vue.use(compositionApi) before
 * using this plugin.
 *
 * @param Vue           current Vue
 * @param options       login options
 */
export default function popupLoginPlugin<UserAuthenticationState extends AuthenticationState>(
    Vue: typeof _Vue, options: PopupLoginPluginOptions<UserAuthenticationState>
) {
    const $auth = usePopupLogin(options);
    Vue.prototype.$auth = $auth
    if (options.router) {

        options.router.beforeEach(async (to, from, next) => {
            const authorization = (to.meta as RouteMeta<UserAuthenticationState>).authorization
            if (!authorization) {
                next()
            } else {
                while (true) {
                    const authorized = await $auth.loginAndAuthorize(
                        authorization.needsRequired || [],
                        {
                            route: to
                        })
                    if (authorized) {
                        next()
                        break
                    }
                }
            }
        })
    }
}
