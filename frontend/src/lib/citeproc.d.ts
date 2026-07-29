declare module 'citeproc' {
  interface CiteprocEngine {
    processCitationCluster(
      citation: unknown,
      pre: [string, number][],
      post: [string, number][],
    ): [unknown, [number, string, string][]]
    makeBibliography(): [{ bibstart: string; bibend: string }, string[]] | false
  }

  interface CiteprocModule {
    Engine: new (sys: unknown, style: string) => CiteprocEngine
    default?: CiteprocModule
  }

  const citeproc: CiteprocModule
  export default citeproc
}
