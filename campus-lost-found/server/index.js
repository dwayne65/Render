require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const { MongoClient, ObjectId } = require('mongodb');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/CampusLostFound';
if (!/^mongodb(\+srv)?:\/\/[^<>\s]+$/.test(MONGODB_URI)) {
  throw new Error(
    'MONGODB_URI is missing or still contains placeholder text. Set it to your MongoDB Atlas connection string (mongodb+srv://user:password@cluster.../CampusLostFound).'
  );
}
const DATABASE_NAME = new URL(MONGODB_URI).pathname.slice(1) || 'CampusLostFound';
const COLLECTION_NAMES = ['students', 'lostItems', 'foundItems', 'claims'];
const SESSION_COLLECTION_NAME = 'sessions';
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const client = new MongoClient(MONGODB_URI);
const app = express();

let collections;

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(express.json({ limit: '10mb' }));
const sessionOptions = {
  name: 'campus.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
};
if (process.env.NODE_ENV === 'production') {
  sessionOptions.store = MongoStore.create({
    clientPromise: client.connect(),
    dbName: DATABASE_NAME,
    collectionName: SESSION_COLLECTION_NAME,
    autoRemove: 'disabled'
  });
}
app.use(session(sessionOptions));

function publicStudent(student) {
  if (!student) return null;
  const { password, passwordHash, ...safeStudent } = student;
  return { ...safeStudent, id: String(student.id || student._id) };
}

function toClientDocument(document) {
  return { ...document, id: String(document.id || document._id) };
}

function idFilter(id) {
  const alternatives = [{ id }];
  if (ObjectId.isValid(id)) alternatives.push({ _id: new ObjectId(id) });
  return { $or: alternatives };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  return asyncRoute(async (request, response, done) => {
    const student = await collections.students.findOne(idFilter(request.session.user.id));
    if (!student) {
      request.session.destroy(() => {});
      return response.status(401).json({ error: 'Your account could not be found.' });
    }
    request.session.user = {
      id: String(student.id || student._id),
      role: student.role,
      studentId: student.studentId
    };
    done();
  })(req, res, next);
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Administrator access is required.' });
    }
    next();
  });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function isValidString(value, maxLength = 5000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedPassword) {
  if (typeof storedPassword !== 'string') return false;
  const [scheme, salt, hash] = storedPassword.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) {
    const submitted = Buffer.from(password);
    const stored = Buffer.from(storedPassword);
    return submitted.length === stored.length && crypto.timingSafeEqual(submitted, stored);
  }

  const expected = Buffer.from(hash, 'hex');
  if (!expected.length || expected.length !== hash.length / 2 || hash.length % 2 !== 0) return false;
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.get('/api/health', asyncRoute(async (req, res) => {
  await client.db(DATABASE_NAME).command({ ping: 1 });
  res.json({ status: 'ok', database: DATABASE_NAME });
}));

app.get('/api/state', asyncRoute(async (req, res) => {
  const sessionUser = req.session.user;
  const [lostItems, foundItems] = await Promise.all([
    collections.lostItems.find({}).toArray(),
    collections.foundItems.find({}).toArray()
  ]);
  const state = {
    students: [],
    lostItems: lostItems.map(toClientDocument),
    foundItems: foundItems.map(toClientDocument),
    claims: [],
    currentUser: null
  };

  if (sessionUser) {
    const storedUser = await collections.students.findOne(idFilter(sessionUser.id));
    if (!storedUser) {
      req.session.destroy(() => {});
    } else {
      const currentUser = publicStudent(storedUser);
      req.session.user = {
        id: currentUser.id,
        role: currentUser.role,
        studentId: currentUser.studentId
      };
      state.currentUser = currentUser;
      state.students = currentUser.role === 'admin'
        ? (await collections.students.find({}).toArray()).map(publicStudent)
        : [currentUser];
      const claims = currentUser.role === 'admin'
        ? await collections.claims.find({}).toArray()
        : await collections.claims.find({ studentId: currentUser.studentId }).toArray();
      state.claims = claims.map(toClientDocument);
    }
  }

  res.json(state);
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  if (!isValidString(email, 320) || !isValidString(password, 1024)) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const student = await collections.students.findOne({
    email: new RegExp(`^${escapeRegex(email)}$`, 'i')
  });
  if (!student || !verifyPassword(password, student.password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!student.password.startsWith('scrypt$')) {
    await collections.students.updateOne(
      idFilter(String(student.id || student._id)),
      { $set: { password: hashPassword(password) } }
    );
  }

  const safeStudent = publicStudent(student);
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
  req.session.user = { id: safeStudent.id, role: safeStudent.role, studentId: safeStudent.studentId };
  res.json(safeStudent);
}));

app.post('/api/auth/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('campus.sid');
    res.status(204).end();
  });
});

app.post('/api/students', asyncRoute(async (req, res) => {
  const { fullName, studentId, email, phone, password } = req.body;
  if (![fullName, studentId, email, phone, password].every((value) => isValidString(value))) {
    return res.status(400).json({ error: 'All registration fields are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const duplicate = await collections.students.findOne({
    $or: [
      { email: new RegExp(`^${escapeRegex(email.trim())}$`, 'i') },
      { studentId: studentId.trim() }
    ]
  });
  if (duplicate) {
    return res.status(409).json({ error: 'That email or student ID is already registered.' });
  }

  const student = {
    id: `student-${crypto.randomUUID()}`,
    fullName: fullName.trim(),
    studentId: studentId.trim(),
    email: email.trim(),
    phone: phone.trim(),
    password: hashPassword(password),
    role: 'student',
    createdAt: new Date().toISOString()
  };
  await collections.students.insertOne(student);
  res.status(201).json(publicStudent(student));
}));

app.get('/api/students', requireAdmin, asyncRoute(async (req, res) => {
  const students = await collections.students.find({}).toArray();
  res.json(students.map(publicStudent));
}));

app.patch('/api/students/:id', requireAdmin, asyncRoute(async (req, res) => {
  const allowedFields = ['fullName', 'studentId', 'email', 'phone', 'role'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([field]) => allowedFields.includes(field))
  );
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No supported student fields were provided.' });
  }
  const result = await collections.students.findOneAndUpdate(
    idFilter(req.params.id),
    { $set: updates },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Student not found.' });
  res.json(publicStudent(result));
}));

app.delete('/api/students/:id', requireAdmin, asyncRoute(async (req, res) => {
  const result = await collections.students.deleteOne(idFilter(req.params.id));
  if (!result.deletedCount) return res.status(404).json({ error: 'Student not found.' });
  res.status(204).end();
}));

function registerItemRoutes(route, collectionName, kind) {
  const getCollection = () => collections[collectionName];
  app.get(`/api/${route}`, asyncRoute(async (req, res) => {
    const documents = await getCollection().find({}).toArray();
    res.json(documents.map(toClientDocument));
  }));

  app.post(`/api/${route}`, requireAuth, asyncRoute(async (req, res) => {
    const allowed = kind === 'lost'
      ? ['itemName', 'category', 'description', 'dateLost', 'location', 'features', 'contact', 'image']
      : ['itemName', 'category', 'description', 'dateFound', 'location', 'condition', 'features', 'holdingLocation', 'contact', 'image'];
    const item = {};
    for (const field of allowed) {
      if (req.body[field] !== undefined) item[field] = req.body[field];
    }
    if (!['itemName', 'category', 'description', 'location'].every((field) => isValidString(item[field]))) {
      return res.status(400).json({ error: 'Item name, category, description, and location are required.' });
    }
    item.id = `${kind}-${crypto.randomUUID()}`;
    item.reportBy = req.session.user.id;
    item.status = kind === 'lost' ? 'pending' : 'available';
    item.createdAt = new Date().toISOString();
    await getCollection().insertOne(item);
    res.status(201).json(toClientDocument(item));
  }));

  app.patch(`/api/${route}/:id`, requireAdmin, asyncRoute(async (req, res) => {
    const allowed = kind === 'lost'
      ? ['itemName', 'category', 'description', 'dateLost', 'location', 'features', 'contact', 'image', 'status']
      : ['itemName', 'category', 'description', 'dateFound', 'location', 'condition', 'features', 'holdingLocation', 'contact', 'image', 'status'];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([field]) => allowed.includes(field))
    );
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No supported item fields were provided.' });
    }

    const result = await getCollection().findOneAndUpdate(
      idFilter(req.params.id),
      { $set: updates },
      { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Item not found.' });
    res.json(toClientDocument(result));
  }));

  app.delete(`/api/${route}/:id`, requireAdmin, asyncRoute(async (req, res) => {
    const result = await getCollection().deleteOne(idFilter(req.params.id));
    if (!result.deletedCount) return res.status(404).json({ error: 'Item not found.' });
    res.status(204).end();
  }));
}

registerItemRoutes('lost-items', 'lostItems', 'lost');
registerItemRoutes('found-items', 'foundItems', 'found');

app.get('/api/claims', requireAuth, asyncRoute(async (req, res) => {
  const filter = req.session.user.role === 'admin'
    ? {}
    : { studentId: req.session.user.studentId };
  const claims = await collections.claims.find(filter).toArray();
  res.json(claims.map(toClientDocument));
}));

app.post('/api/claims', requireAuth, asyncRoute(async (req, res) => {
  const { foundItemId, explanation, distinguishingFeatures, additionalInfo } = req.body;
  if (!isValidString(foundItemId, 200) || !isValidString(explanation) || !isValidString(distinguishingFeatures)) {
    return res.status(400).json({ error: 'Found item, explanation, and distinguishing features are required.' });
  }

  const student = await collections.students.findOne(idFilter(req.session.user.id));
  if (!student) return res.status(401).json({ error: 'Your account could not be found.' });
  const item = await collections.foundItems.findOne(idFilter(foundItemId));
  if (!item) return res.status(404).json({ error: 'Found item not found.' });

  const claim = {
    id: `claim-${crypto.randomUUID()}`,
    reference: `BLF-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    foundItemId,
    claimantName: student.fullName,
    studentId: student.studentId,
    explanation: explanation.trim(),
    distinguishingFeatures: distinguishingFeatures.trim(),
    additionalInfo: String(additionalInfo || '').trim(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    adminNotes: ''
  };
  await collections.claims.insertOne(claim);
  res.status(201).json(toClientDocument(claim));
}));

app.patch('/api/claims/:id', requireAdmin, asyncRoute(async (req, res) => {
  const allowedStatuses = ['pending', 'under_review', 'approved', 'rejected', 'completed'];
  const { status, adminNotes } = req.body;
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: 'A valid claim status is required.' });
  }

  const updates = { status };
  if (adminNotes !== undefined) updates.adminNotes = String(adminNotes).slice(0, 5000);
  const result = await collections.claims.findOneAndUpdate(
    idFilter(req.params.id),
    { $set: updates },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ error: 'Claim not found.' });
  res.json(toClientDocument(result));
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'The request could not be completed.' });
});

app.use((req, res, next) => {
  if (/^\/(?:server|node_modules|\.git|package(?:-lock)?\.json|\.env)/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(path.join(__dirname, '..'), { dotfiles: 'deny' }));

async function start() {
  await client.connect();
  const database = client.db(DATABASE_NAME);
  const existing = new Set(
    (await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name)
  );
  const requiredCollections = process.env.NODE_ENV === 'production'
    ? [...COLLECTION_NAMES, SESSION_COLLECTION_NAME]
    : COLLECTION_NAMES;
  const missing = requiredCollections.filter((name) => !existing.has(name));
  if (missing.length) {
    throw new Error(`Required existing MongoDB collections are missing: ${missing.join(', ')}. No collections were created.`);
  }
  collections = Object.fromEntries(COLLECTION_NAMES.map((name) => [name, database.collection(name)]));

  app.listen(PORT, HOST, () => {
    console.log(`Campus Lost & Found is running at http://localhost:${PORT}`);
    console.log(`Connected to MongoDB database "${DATABASE_NAME}".`);
  });
}

start().catch(async (error) => {
  console.error(`Startup failed: ${error.message}`);
  await client.close().catch(() => {});
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.close();
    process.exit(0);
  });
}
