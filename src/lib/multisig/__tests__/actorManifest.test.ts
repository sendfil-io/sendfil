import { describe, expect, it } from 'vitest';
import { bytesToParamsBase64, decodeCidBytes, paramsBase64ToBytes } from '../actorParams';
import {
  decodeMultisigActorCodeCid,
  getBuiltinActorsManifestCid,
  getSystemActorAddress,
} from '../actorManifest';

// Live ChainReadObj payloads captured from the public Mainnet and Calibration
// System actor BuiltinActors links. Keeping literal vectors makes the parser
// independent from both its test encoders and third-party DAG-CBOR packages.
const MAINNET_MANIFEST_BASE64 =
  'kIJmc3lzdGVt2CpYJwABVaDkAiB9YMR+dBr1lGCzaebr5rWAmZU8umG1d5SH/4a1DUYyIoJkaW5pdNgqWCcAAVWg5AIg4vhxVvX+KH9W4bhbd9ZPmL4HY3EBjycIqzgzquhISe2CZGNyb27YKlgnAAFVoOQCIBUcuxYME8tFOHb2DMXuypuo2D+CBlZIYOay/EGIcdv3gmdhY2NvdW502CpYJwABVaDkAiBn13NnHUkF8nCLY/Cb2g42Pe/DHIq9r/q5BnXKISeagIJsc3RvcmFnZXBvd2Vy2CpYJwABVaDkAiD9Y/nDD3+kpIaPq3dRWShW/9XGQ8FA9jJaQvd1jt9B1IJsc3RvcmFnZW1pbmVy2CpYJwABVaDkAiAHrc2n3i19CtQZZtNKRUmfOVY7aB3718wRXT+aqacCBYJtc3RvcmFnZW1hcmtldNgqWCcAAVWg5AIgxjyuCIqn7YKAFnhHGVKxUnCDAuMXGVZXRfigtTrTEsyCbnBheW1lbnRjaGFubmVs2CpYJwABVaDkAiBpby9auU8+GryHVzV70seQF/nU9u1ceyBGMoJWmxL5XYJobXVsdGlzaWfYKlgnAAFVoOQCII2EUA2U0iG7m7qBfX+HZjBUW+mnOUqLESAw5r/x2Vi5gmZyZXdhcmTYKlgnAAFVoOQCILu052ic+95rhA4bogNxF7Wa4xFshX2ZVeUXbRzuXdCEgnB2ZXJpZmllZHJlZ2lzdHJ52CpYJwABVaDkAiBaR/o0QrBDL8l3kjH8bIq1WKuXZizoaN58uzZWk6byEoJnZGF0YWNhcNgqWCcAAVWg5AIgxajyJdCa4re5O24LHU3nOngZD5lkPn+eIlqmGBymdZKCa3BsYWNlaG9sZGVy2CpYJwABVaDkAiDLWk9MwRZMQ98q0ijbilMb14ejfh2XVT9L3Ez1EWi3F4JjZXZt2CpYJwABVaDkAiA79AfldKCyEPfufUq4SlburtoYEwxOs5EsOPnH94qLJIJjZWFt2CpYJwABVaDkAiC4Gz51UWotalp8GcyOv/gdHD6YVDex2WFhqC7Nb5UJe4JqZXRoYWNjb3VudNgqWCcAAVWg5AIgg7IE4aswAvVnqNy2juUSqOvQ0vHlZwH3sAWCfOC/+uo=';
const CALIBRATION_MANIFEST_BASE64 =
  'kIJmc3lzdGVt2CpYJwABVaDkAiChv3q0Q+lGrRPCSAT+H0EuRgnqr8PWkm6lxOtyEeCj4YJkaW5pdNgqWCcAAVWg5AIglAA+yNaH3zYLagkAPsCDECr90Jho6wOVLESoR57pANWCZGNyb27YKlgnAAFVoOQCID0J9yr7fZ3c22N9EI+8QluYKz9g58qhqRLwsz+co0FPgmdhY2NvdW502CpYJwABVaDkAiAARUWQ2KDcuVZlFSNH9YGkt7PfCs+ynTwVjNV2pnKkBoJsc3RvcmFnZXBvd2Vy2CpYJwABVaDkAiC5wzQ8ZOdxwoXle+6VBk9Xx0KGNjpHFnYw61kwhIHm2oJsc3RvcmFnZW1pbmVy2CpYJwABVaDkAiDYmWge1TqJGUSyQIV7N4bcGLrAW0Oq1UxD3Mi7UakkfYJtc3RvcmFnZW1hcmtldNgqWCcAAVWg5AIgA5H8OJ1fUDJ0a6EgpWc86d1WMj1IvhxcR9/dQVmlKBWCbnBheW1lbnRjaGFubmVs2CpYJwABVaDkAiCwKOuhRwsLPVFWEAiI+4LOBU/L6tDbxlyr05r0Gwd7E4JobXVsdGlzaWfYKlgnAAFVoOQCII8ZBt7rkhVOPtysmnTf1/pV7XdiGxz8YGR4wnrQ8VN2gmZyZXdhcmTYKlgnAAFVoOQCIGPxCn8zpzZV4+YJ0FexCR0DnW1GEZpuY3IBqu05NlAdgnB2ZXJpZmllZHJlZ2lzdHJ52CpYJwABVaDkAiB9Jb0D2X7EQz5WF4mPQMraYIiaTIH36E6WyJai9wT6KoJnZGF0YWNhcNgqWCcAAVWg5AIg/F2RzDgA28omtd/3II1J/hBEDK55pVuytLInu5wwMdaCa3BsYWNlaG9sZGVy2CpYJwABVaDkAiDLWk9MwRZMQ98q0ijbilMb14ejfh2XVT9L3Ez1EWi3F4JjZXZt2CpYJwABVaDkAiB9taewxfx4zAZfGLgsHoh0tBnkMukTlq3QK0ChntOxcYJjZWFt2CpYJwABVaDkAiDs7vCMKf9xgxFrk1Cgx4DtWAmABN1RNqVmw7c6lnjyj4JqZXRoYWNjb3VudNgqWCcAAVWg5AIg6UAVVkHUs7Y2iJNSMDLU9cYDDsd4PHH292bXZzBChhk=';

const MAINNET_MULTISIG_CODE_CID =
  'bafk2bzacecgyiuanstjcdo43xkax274hmyyfiw7ju44uvcyreayonp7r3fmls';
const CALIBRATION_MULTISIG_CODE_CID =
  'bafk2bzacechrsbw65ojbktr63swju5g7275fl3lxminrz7damr4me6wq6fjxm';

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function encodeLength(major: number, length: number): Uint8Array {
  if (length < 24) {
    return Uint8Array.from([(major << 5) | length]);
  }

  if (length <= 0xff) {
    return Uint8Array.from([(major << 5) | 24, length]);
  }

  throw new Error('Test fixture length is too large');
}

function encodeManifest(entries: Array<[string, string]>): string {
  const encodedEntries = entries.map(([name, cid]) => {
    const nameBytes = new TextEncoder().encode(name);
    const cidBytes = concatBytes(Uint8Array.from([0]), decodeCidBytes(cid));

    return concatBytes(
      Uint8Array.from([0x82]),
      encodeLength(3, nameBytes.length),
      nameBytes,
      Uint8Array.from([0xd8, 0x2a]),
      encodeLength(2, cidBytes.length),
      cidBytes,
    );
  });

  return bytesToParamsBase64(concatBytes(encodeLength(4, entries.length), ...encodedEntries));
}

describe('builtin actor manifest resolver', () => {
  it('uses the network-specific System actor ID address', () => {
    expect(getSystemActorAddress('mainnet')).toBe('f00');
    expect(getSystemActorAddress('calibration')).toBe('t00');
  });

  it('resolves the live Mainnet multisig actor code CID', () => {
    expect(decodeMultisigActorCodeCid(MAINNET_MANIFEST_BASE64)).toBe(
      MAINNET_MULTISIG_CODE_CID,
    );
  });

  it('resolves the live Calibration multisig actor code CID', () => {
    expect(decodeMultisigActorCodeCid(CALIBRATION_MANIFEST_BASE64)).toBe(
      CALIBRATION_MULTISIG_CODE_CID,
    );
  });

  it('extracts only a well-formed BuiltinActors CID link from System actor state', () => {
    const manifestCid = 'bafy2bzacea275suujjuaddglc2kbbgracldjbbs5cjys6zsivcswubv5x7es4';

    expect(
      getBuiltinActorsManifestCid({
        Balance: '0',
        State: { BuiltinActors: { '/': manifestCid } },
      }),
    ).toBe(manifestCid);
  });

  it.each([
    undefined,
    {},
    { State: null },
    { State: {} },
    { State: { BuiltinActors: 'bafyinvalid' } },
    { State: { BuiltinActors: { '/': '' } } },
    { State: { BuiltinActors: { '/': 'bafyvalid' } } },
    { State: { BuiltinActors: { '/': 'BAFYINVALID' } } },
    { State: { BuiltinActors: { '/': 'bafyvalid', extra: true } } },
  ])('rejects malformed System actor state %#', (state) => {
    expect(() => getBuiltinActorsManifestCid(state)).toThrow();
  });

  it('rejects duplicate actor names instead of selecting an ambiguous CID', () => {
    const manifest = encodeManifest([
      ['multisig', MAINNET_MULTISIG_CODE_CID],
      ['multisig', CALIBRATION_MULTISIG_CODE_CID],
    ]);

    expect(() => decodeMultisigActorCodeCid(manifest)).toThrow('duplicate "multisig"');
  });

  it('rejects a manifest with no multisig entry', () => {
    const manifest = encodeManifest([['system', MAINNET_MULTISIG_CODE_CID]]);

    expect(() => decodeMultisigActorCodeCid(manifest)).toThrow(
      'does not contain a multisig entry',
    );
  });

  it('rejects trailing CBOR data after an otherwise valid manifest', () => {
    const manifest = encodeManifest([['multisig', MAINNET_MULTISIG_CODE_CID]]);
    const withTrailingData = bytesToParamsBase64(
      concatBytes(paramsBase64ToBytes(manifest), Uint8Array.from([0])),
    );

    expect(() => decodeMultisigActorCodeCid(withTrailingData)).toThrow('trailing CBOR data');
  });

  it('rejects malformed list-pair framing and CID links', () => {
    const manifest = paramsBase64ToBytes(
      encodeManifest([['multisig', MAINNET_MULTISIG_CODE_CID]]),
    );
    const wrongTopLevelType = manifest.slice();
    wrongTopLevelType[0] = 0xa1;
    const wrongPairLength = manifest.slice();
    wrongPairLength[1] = 0x81;
    const missingCidIdentityPrefix = manifest.slice();
    missingCidIdentityPrefix[15] = 1;
    const truncatedCid = manifest.slice(0, -1);

    expect(() =>
      decodeMultisigActorCodeCid(bytesToParamsBase64(wrongTopLevelType)),
    ).toThrow('wrong CBOR type');
    expect(() => decodeMultisigActorCodeCid(bytesToParamsBase64(wrongPairLength))).toThrow(
      'name/CID pairs',
    );
    expect(() =>
      decodeMultisigActorCodeCid(bytesToParamsBase64(missingCidIdentityPrefix)),
    ).toThrow('identity prefix');
    expect(() => decodeMultisigActorCodeCid(bytesToParamsBase64(truncatedCid))).toThrow(
      'malformed',
    );
  });

  it.each(['', '@@@=', 'Zg=', 'Zh=='])('rejects malformed or non-canonical base64 %j', (value) => {
    expect(() => decodeMultisigActorCodeCid(value)).toThrow('canonical base64');
  });
});
