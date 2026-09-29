import fs from 'node:fs'
import path from 'node:path'
import forge from 'node-forge'
import { certDir } from './db'

export function ensureCertificates(hosts: string[]): { key: string; cert: string; ca: string } {
  const keyPath = path.join(certDir, 'server.key')
  const certPath = path.join(certDir, 'server.crt')
  const caPath = path.join(certDir, 'ca.crt')
  const caKeyPath = path.join(certDir, 'ca.key')
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(caPath)) {
    return {
      key: fs.readFileSync(keyPath, 'utf8'),
      cert: fs.readFileSync(certPath, 'utf8'),
      ca: fs.readFileSync(caPath, 'utf8'),
    }
  }
  const caKeys = forge.pki.rsa.generateKeyPair(2048)
  const caCert = forge.pki.createCertificate()
  caCert.publicKey = caKeys.publicKey
  caCert.serialNumber = '01'
  caCert.validity.notBefore = new Date()
  caCert.validity.notAfter = new Date()
  caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10)
  const caAttrs = [{ name: 'commonName', value: 'Agency Signage Local CA' }]
  caCert.setSubject(caAttrs)
  caCert.setIssuer(caAttrs)
  caCert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, digitalSignature: true, cRLSign: true }])
  caCert.sign(caKeys.privateKey, forge.md.sha256.create())

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '02'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5)
  cert.setSubject([{ name: 'commonName', value: hosts[0] || 'signage.local' }])
  cert.setIssuer(caAttrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: hosts.flatMap((host) => hostEntries(host)) },
  ])
  cert.sign(caKeys.privateKey, forge.md.sha256.create())

  const keyPem = forge.pki.privateKeyToPem(keys.privateKey)
  const certPem = forge.pki.certificateToPem(cert)
  const caPem = forge.pki.certificateToPem(caCert)
  fs.writeFileSync(caKeyPath, forge.pki.privateKeyToPem(caKeys.privateKey))
  fs.writeFileSync(keyPath, keyPem)
  fs.writeFileSync(certPath, certPem)
  fs.writeFileSync(caPath, caPem)
  return { key: keyPem, cert: certPem, ca: caPem }
}

function hostEntries(host: string): { type: number; value?: string; ip?: string }[] {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return [{ type: 7, ip: host }]
  return [{ type: 2, value: host }]
}
