# Terms version archive

Each published Terms version must remain in this directory as an immutable, date-labeled component.
`TermsOfServiceContent.tsx` points to the version currently shown by the app. When publishing a
revision:

1. leave every previously published version unchanged;
2. add a new date-labeled component;
3. update `TERMS_VERSION` and `TERMS_LAST_UPDATED` together;
4. point `TermsOfServiceContent.tsx` to the new component; and
5. retain the release commit and a copy of the exact rendered version supplied on request.

The `2026-08-25` component is the initial draft requested for publication on August 25, 2026. If it
is not actually published on that date, create a correctly dated version instead of relabeling a
version that users have already accepted.
