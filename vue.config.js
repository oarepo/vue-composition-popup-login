const path = require('path')

const state = {
    authState: {
        loggedIn: false
    }
}

const people = {
    'john': {
        loggedIn: true,
        name: 'John',
        needsProvided: []
    },
    'mary': {
        loggedIn: true,
        name: 'Mary',
        needsProvided: []
    },
    'admin': {
        loggedIn: true,
        name: 'Administrator',
        superuser: true,
        needsProvided: []
    },
    'wrong': {
        loggedIn: false,
        name: 'A user that is unable to log in'
    }
}

module.exports = {
    configureWebpack(cfg) {
        cfg.resolve.alias['@oarepo/vue-composition-popup-login'] = path.join(__dirname, 'library/index.js')
    },
    devServer: {
        https: true,
        port: 8080,
        host: 'localhost',
        before: function (app) {
            app.get('/auth/state', function (req, res) {
                res.json(state.authState)
            })
            app.get('/auth/complete', function (req, res) {
                const username = req.query.username
                state.authState = people[username]
                if (req.query.next) {
                    res.redirect(res.query.next)
                } else {
                    res.send(`
                        <html>
                            <body style="display: flex; justify-content: center;">
                                <div style="max-width: 400px;">
                                    <h3 style="border-bottom: 1px solid darkgreen; text-align: center; margin-bottom: 40px">Login complete page</h3>
                                    <div style="padding-top: 10px; padding-bottom: 10px;">
                                        The login process has been completed and ${state.authState.name} has been logged in. 
                                        <br><br>
                                        This window should close automatically in 2 seconds. 
                                    </div>
                                    <script>
                                        setTimeout(() => {
                                            const bc = new BroadcastChannel('popup_login_channel');
                                            bc.onmessage = (ev) => {
                                                if (ev.type === 'close_failed') {
                                                    alert('This window could not be closed, please close it yourself')
                                                }
                                            }
                                            bc.postMessage({
                                                type: "login",
                                                status: "${state.authState.loggedIn ? 'success' : 'error'}",
                                                message: "Sample ok/error message from the auth server"
                                            })
                                            setTimeout(() => {
                                                alert('Could not send login data back to the application. Please close this window manually and reload the application')
                                            }, 5000)
                                        }, 5000)
                                    </script>
                                </div>
                            </body>
                        </html>`)
                }
            })
            app.get('/auth/login', function (req, res) {
                const next = req.query.next
                const peopleLoginLinks = Object.entries(people).map(([login, rec]) => `<li><a href="${next}?username=${login}">${rec.name}</a></li>`)
                res.send(`
                    <html>
                        <body style="display: flex; justify-content: center;">
                            <div style="max-width: 400px;">
                                <h3 style="border-bottom: 1px solid darkgreen; text-align: center; margin-bottom: 40px">External Login Site</h3>
                                <div style="padding-top: 10px; padding-bottom: 10px;">
                                    A sample test site to log in users. Normally it would reside on a different server and communicate
                                    with the application via openid or shibboleth protocols.
                                </div>
                                <div style="padding-top: 10px; padding-bottom: 10px;">
                                    This implementation just passes the username to the login complete url. 
                                </div>
                                <h4>Log in:</h4>
                                <ul>
                                    ${peopleLoginLinks.join('<br><br>')}
                                </ul>
                            </div>
                        </body>
                    </html>`)
            })
        }
    }
}
