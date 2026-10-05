export function requireUser(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'user') {
    return next();
  }
  req.session.flash = { type: 'error', message: 'Please log in as a customer to continue.' };
  const sidQuery = (req.query.sid || req.sessionID) ? `?sid=${req.query.sid || req.sessionID}` : '';
  return res.redirect('/login' + sidQuery);
}

export function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  req.session.flash = { type: 'error', message: 'Access denied. Please log in as an administrator.' };
  const sidQuery = (req.query.sid || req.sessionID) ? `?sid=${req.query.sid || req.sessionID}` : '';
  return res.redirect('/admin/login' + sidQuery);
}

export function redirectIfUserLoggedIn(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'user') {
    const sidQuery = (req.query.sid || req.sessionID) ? `?sid=${req.query.sid || req.sessionID}` : '';
    return res.redirect('/dashboard' + sidQuery);
  }
  next();
}

export function redirectIfAdminLoggedIn(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    const sidQuery = (req.query.sid || req.sessionID) ? `?sid=${req.query.sid || req.sessionID}` : '';
    return res.redirect('/admin/dashboard' + sidQuery);
  }
  next();
}

export function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.user) {
    const sidQuery = (req.query.sid || req.sessionID) ? `?sid=${req.query.sid || req.sessionID}` : '';
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/dashboard' + sidQuery);
    }
    return res.redirect('/dashboard' + sidQuery);
  }
  next();
}
