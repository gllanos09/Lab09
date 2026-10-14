require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const BUCKET = process.env.S3_BUCKET;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 5;

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: CLIENT_ID,
});

async function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Falta token' });
  try {
    const payload = await verifier.verify(token);
    req.userSub = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    await cognito.send(new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: 'email', Value: email }],
    }));
    res.json({ ok: true, message: 'Revisa tu correo para el código de confirmación.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/confirm', async (req, res) => {
  try {
    const { email, code } = req.body;
    await cognito.send(new ConfirmSignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    }));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const resp = await cognito.send(new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }));
    const { AccessToken, IdToken, ExpiresIn } = resp.AuthenticationResult;
    res.json({ accessToken: AccessToken, idToken: IdToken, expiresIn: ExpiresIn });
  } catch (err) {
    res.status(401).json({ error: 'Credenciales inválidas' });
  }
});

app.post('/api/upload-url', authRequired, async (req, res) => {
  try {
    const { filename, contentType, sizeBytes, proyecto } = req.body;
    if (!filename || !contentType || typeof sizeBytes !== 'number') {
      return res.status(400).json({ error: 'Faltan campos: filename, contentType, sizeBytes' });
    }
    if (!ALLOWED_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Tipo de archivo no permitido' });
    }
    if (sizeBytes > MAX_SIZE_MB * 1024 * 1024) {
      return res.status(400).json({ error: 'Archivo demasiado grande' });
    }

    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `originales/${req.userSub}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;

    const tagValue = (proyecto || 'sin-proyecto').replace(/[^a-zA-Z0-9-_. ]/g, '').slice(0, 50);
    const tagging = `proyecto=${encodeURIComponent(tagValue)}&owner=${encodeURIComponent(req.userSub)}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
      Tagging: tagging,
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 300 });
    console.log('DEBUG url:', url);
    console.log('DEBUG tagging:', tagging);
    res.json({ uploadUrl: url, key, tagging });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando la URL de carga' });
  }
});

app.get('/api/images', authRequired, async (req, res) => {
  try {
    const prefix = `originales/${req.userSub}/`;
    const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix }));

    const items = await Promise.all((list.Contents || []).map(async (obj) => {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }),
        { expiresIn: 900 }
      );
      return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified, url };
    }));

    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error listando imágenes' });
  }
});

app.delete('/api/images/:key', authRequired, async (req, res) => {
  try {
    const key = req.params.key;
    if (!key.startsWith(`originales/${req.userSub}/`)) {
      return res.status(403).json({ error: 'No autorizado sobre este objeto' });
    }
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando la imagen' });
  }
});

app.listen(process.env.PORT || 3000, '0.0.0.0', () =>
  console.log(`API escuchando en :${process.env.PORT || 3000}`)
);
