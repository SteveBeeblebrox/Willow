/// (c) Trin Wasinger 2026
namespace Willow {
    namespace Util {
        export type PeekableIterableIterator<T> = IterableIterator<T> & {
            peek: () => T | undefined;
        }

        export function createPeekableIterator<T>(iterable: Iterable<T>): PeekableIterableIterator<T> {
            const iter: Iterator<T> = iterable[Symbol.iterator]();
            let next = iter.next();

            const it = (function*() {
                let done: boolean | undefined = false, value;
                while(!done) {
                    ({ done, value } = next);

                    if(!done) {
                        next = iter.next();
                        yield value;
                    }
                }
            })() as unknown as PeekableIterableIterator<T>;

            it.peek = function peek() {
                return next.value;
            }

            return it;
        }

        export const throws = (error: any) => {throw error;};
    }

    export namespace Internals {
        export class Token {
            public constructor(public readonly name: string, public readonly text: string, public readonly pos: number) {}
            public get length() {return this.text.length};
        }

        export class MathMLNode {
            public readonly children: (string | MathMLNode)[];
            public readonly attributes: {[key: string]: string} = Object.create(null);
            public constructor(public readonly name:
                    'math' | 
                    'semantics' | 'annotation' | 'annotation-xml' | 
                    'mi' | 'mn' | 'mo' | 'ms' | 'mspace' | 'mtext' |
                    'mfrac' | 'mroot' | 'msqrt' | 
                    'mover' |'munder' | 'munderover' |
                    'mmultiscripts' | 'mprescripts' | 'msub' | 'msup' | 'msubsup' |
                    'mtable' | 'mtd' | 'mtr' |
                    'mpadded' | 'mphantom' |
                    'mstyle' |
                    'mrow' |
                    'merror',
                    ...args: MathMLNode['children'] |[...MathMLNode['children'], MathMLNode['attributes']]
            ) {
                if(args.length && !(args.at(-1) instanceof MathMLNode || typeof(args.at(-1)) === 'string')) {
                    this.children = args.slice(0, -1) as MathMLNode['children'];
                    Object.assign(this.attributes, args.at(-1));
                } else {
                    this.children = args as MathMLNode['children'];
                }
            }

            public static escape(text: string): string {
                return text.replace(/[&<>"]/g, match => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[match] ?? '');
            }

            public toString(): string {
                const attrs = Object.entries(this.attributes).map(([k,v]) => ` ${k}="${MathMLNode.escape(v)}"`).join('');
                return this.children.length ? `<${this.name}${attrs}>${
                    this.children.map(child => child instanceof MathMLNode ? child.toString() : MathMLNode.escape(child))
                }</${this.name}>` : `<${this.name}${attrs}/>`;
            }

            public toMathMLElement(): (typeof globalThis) extends {'MathMLElement': {prototype: infer T}} ? T : never {
                const element = document.createElementNS('http://www.w3.org/1998/Math/MathML', this.name);
                Object.entries(this.attributes).forEach(([key, value]) => element.setAttribute(key, value));
                element.replaceChildren(
                    ...this.children.map(child => child instanceof MathMLNode ? child.toMathMLElement() : child)
                );
                return element;
            }
        }

        export function invokeCallback(callback: string, tokens: Util.PeekableIterableIterator<Token>, pos: number, ...args: any[]): MathMLNode[] {
            switch(typeof Willow.Config.CALLBACKS[callback]) {
                case 'function': return Willow.Config.CALLBACKS[callback](tokens, ...args);
                case 'object': return Willow.Config.CALLBACKS[callback];
                default: throw new Error(`Unknown callback '${callback}' at position ${pos}`);
            }
        }

        export function peekToken(tokenName: string | undefined, tokens: Util.PeekableIterableIterator<Token>): Token | null {
            if(tokenName === '*' || tokens.peek()?.name === tokenName) {
                return tokens.peek() ?? null;
            } else {
                return null;
            }
        }

        export function expectToken(tokenName: string | undefined, tokens: Util.PeekableIterableIterator<Token>): Token | never {
            return peekToken(tokenName, tokens) || tokenName == null ? tokens.next().value : Util.throws(new Error(`Expected token '${tokenName ?? 'EOF'}', got '${peekToken('*', tokens)?.name ?? 'EOF'}' at position ${peekToken('*', tokens)?.pos ?? -1}`));
        }

        export function acceptToken(tokenName: string | undefined, tokens: Util.PeekableIterableIterator<Token>): Token | null {
            return peekToken(tokenName, tokens) && tokens.next().value;
        }

        export function unwrapAndExpectToken(tokenName: string, tokens: Util.PeekableIterableIterator<Token>): Token | never {
            if(acceptToken('__group_start__', tokens)) {
                const keyword = unwrapAndExpectToken(tokenName, tokens);
                expectToken('__group_end__', tokens);
                return keyword;
            } else {
                return expectToken(tokenName, tokens);
            }
        }

        export namespace SyntaxPrimitives {
            export function group(tokens: Util.PeekableIterableIterator<Token>): MathMLNode[] {
                expectToken('__group_start__', tokens);
                const contents = math(tokens);
                expectToken('__group_end__', tokens);
                return contents;
            }

            export function callback(tokens: Util.PeekableIterableIterator<Token>): MathMLNode[] {
                const token = expectToken('__callback__', tokens);
                return invokeCallback(token.text.slice(1), tokens, token.pos);
            }
    
            export function math(tokens: Util.PeekableIterableIterator<Token>): MathMLNode[] {
                const nodes: MathMLNode[] = [];
                while(peekToken('*', tokens) && !peekToken('__group_end__', tokens)) {
                    nodes.push(...maybescriptexpr(tokens));
                }
                return nodes;
            }

            export function expression(tokens: Util.PeekableIterableIterator<Token>): MathMLNode[] {
                for(const token of ['__whitespace__', '__symbol__', '__number__', '__text__', '__identifier__']) {
                    if(peekToken(token, tokens)) {
                        return invokeCallback(token, tokens, peekToken(token, tokens)!.pos);
                    }
                }
    
                if(peekToken('__group_start__', tokens)) {
                    return group(tokens);
                } else if(peekToken('__callback__', tokens)) {
                    return callback(tokens);
                } else {
                    throw new Error(`Expected start of expression, got token '${peekToken('*', tokens)?.name ?? 'EOF'}' at position ${peekToken('*', tokens)?.pos ?? -1}`);
                }
            }
    
            export function maybescriptexpr(tokens: Util.PeekableIterableIterator<Token>): MathMLNode[] {
                const base = expression(tokens);
                if(acceptToken('__subscript__', tokens)) {
                    const subscript = expression(tokens);
                    if(acceptToken('__superscript__', tokens)) {
                        const superscript = expression(tokens);
                        return [new MathMLNode('msubsup',
                            new MathMLNode('mrow', ...base),
                            new MathMLNode('mrow', ...subscript),
                            new MathMLNode('mrow', ...superscript),
                        )];
                    } else {
                        return [new MathMLNode('msub',
                            new MathMLNode('mrow', ...base),
                            new MathMLNode('mrow', ...subscript),
                        )];
                    }
                } else if(acceptToken('__superscript__', tokens)) {
                    const superscript = expression(tokens);
                    if(acceptToken('__subscript__', tokens)) {
                        const subscript = expression(tokens);
                        return [new MathMLNode('msubsup',
                            new MathMLNode('mrow', ...base),
                            new MathMLNode('mrow', ...subscript),
                            new MathMLNode('mrow', ...superscript),
                        )];
                    } else {
                        return [new MathMLNode('msup',
                            new MathMLNode('mrow', ...base),
                            new MathMLNode('mrow', ...superscript),
                        )];
                    }
                } else {
                    return base;
                }
            }
        }
    }

    import Token = Willow.Internals.Token;

    export namespace Config {
        const SYMBOLS: {[key: string]: string} =
            {plus:'+',minus:'-',times:'×',mul:'×',cross:'×',cdot:'·',div:'÷',slash:'∕',asterisk:'∗',circ:'∘',divides:'∣','!ndivides':'∣','!divides':'∤',ndivides:'∤',prop:'∝',grad:'∇',del:'∇',nabla:'∇',laplace:'∆',increment:'∆',bowtie:'⋈',Bowtie:'⨝',join:'⨝',fact:'!',suchthat:':',mod:'%',modulo:'%',percent:'%',dollar:'$',ampersand:'&',underscore:'_',caret:'^',vdots:'⋮',cdots:'⋯',ddots:'⋱',udots:'⋰',ldots:'…',ellipsis:'…',pm:'±',plusminus:'±',mp:'∓',minusplus:'∓',divtimes:'⋇',divmul:'⋇',oplus:'⊕',ominus:'⊖',otimes:'⊗',omul:'⊗',tensorprod:'⊗',ootimes:'⨷',oomul:'⨷',oslash:'⊘',odiv:'⨸',odot:'⊙',ocirc:'⊚',oasterisk:'⊛',oequals:'⊜',olt:'⧀',ogt:'⧁',obar:'⦶',opipe:'⦶',obbar:'⦷',oppipe:'⦷',odash:'⊝',prime:'′',partial:'∂',angle:'∠',degree:'°',land:'∧',wedge:'∧',lor:'∨',vee:'∨',lnot:'¬',neg:'¬',lrnot:'⌐',rneg:'⌐',lxor:'⊻',lnand:'⊼',lnor:'⊽',ltrue:'⊤',top:'⊤',lfalse:'⊥',bot:'⊥',lparen:'(',rparen:')',lbrace:'[',rbrace:']',lbracket:'{',rbracket:'}',langle:'⟨',rangle:'⟩',llangle:'⟪',rrangle:'⟫',lceil:'⌈',rceil:'⌉',lfloor:'⌊',rfloor:'⌋',pipe:'|',lpipe:'|',rpipe:'|',bar:'|',lbar:'|',rbar:'|',ppipe:'‖',bbar:'¦',brokenpipe:'¦',brokenbar:'¦',bpipe:'¦',pipebar:'⟊',barpipe:'⟊',dag:'†',dagger:'†',ddag:'‡',ddagger:'‡',dddagger:'⹋',hyphen:'-',endash:'–',emdash:'—',leftarrow:'←',gets:'←',rightarrow:'→',to:'→',uparrow:'↑',downarrow:'↓',leftrightarrow:'↔',rightleftarrow:'↔',updownarrow:'↕',downuparrow:'↕',upleftarrow:'↖',leftuparrow:'↖',uprightarrow:'↗',rightuparrow:'↗',downleftarrow:'↙',leftdownarrow:'↙',downrightarrow:'↘',rightdownarrow:'↘',Leftarrow:'⇐',rimplies:'⇐','!Nleftarrow':'⇐','!nrimplies':'⇐',Rightarrow:'⇒',implies:'⇒','!Nrightarrow':'⇒','!nimplies':'⇒',Uparrow:'⇑',Downarrow:'⇓',Leftrightarrow:'⇔',Rightleftarrow:'⇔',iff:'⇔','!Nleftrightarrow':'⇔','!Nrightleftarrow':'⇔','!niff':'⇔',Updownarrow:'⇕',Downuparrow:'⇕',Upleftarrow:'⇖',Leftuparrow:'⇖',Uprightarrow:'⇗',Rightuparrow:'⇗',Downleftarrow:'⇙',Leftdownarrow:'⇙',Downrightarrow:'⇘',Rightdownarrow:'⇘','!Leftarrow':'⇍','!rimplies':'⇍',Nleftarrow:'⇍',nrimplies:'⇍','!Rightarrow':'⇏','!implies':'⇏',Nrightarrow:'⇏',nimplies:'⇏','!Leftrightarrow':'⇎','!Rightleftarrow':'⇎','!iff':'⇎',Nleftrightarrow:'⇎',Nrightleftarrow:'⇎',niff:'⇎',leftarrowtail:'↢',rightarrowtail:'↣',leftarrowbase:'↤',rmapsto:'↤',rightarrowbase:'↦',mapsto:'↦',uparrowbase:'↥',downarrowbase:'↧',downuparrowbase:'↨',updownarrowbase:'↨','+':'undefined',longleftarrow:'⟵',longrightarrow:'⟶',longleftrightarrow:'⟷',Longleftarrow:'⟸',Longrightarrow:'⟹',Longleftrightarrow:'⟺',longleftarrowbase:'⟻',longrightarrowbase:'⟼',Lleftarrow:'⇚',Rrightarrow:'⇛',Uuparrow:'⤊',Ddownarrow:'⤋',leftrightarrows:'⇆',rightleftarrows:'⇄',leftleftarrows:'⇇',rightrightarrows:'⇉',upuparrows:'⇈',downdownarrows:'⇊',downuparrows:'⇵',updownarrows:'⇅',tilde:'∼',sim:'∼','!ntilde':'∼','!nsim':'∼','!tilde':'≁','!sim':'≁',ntilde:'≁',nsim:'≁',rtilde:'∽',rsim:'∽',approx:'≈','!napprox':'≈','!approx':'≉',napprox:'≉',simeq:'≃',asymeq:'≃','!nsimeq':'≃','!nasymeq':'≃','!simeq':'≄','!asymeq':'≄',nsimeq:'≄',nasymeq:'≄',eqsim:'≂',cong:'≅','!ncong':'≅','!cong':'≇',ncong:'≇',approxeq:'≊',doteq:'≐',limeq:'≐',deltaeq:'≜',is:'≜',eq:'=','!neq':'=','!eq':'≠',neq:'≠',equiv:'≡','!nequiv':'≡','!equiv':'≢',nequiv:'≢',strictequiv:'≣',lt:'<','!nlt':'<','!lt':'≮',nlt:'≮',gt:'>','!ngt':'>','!gt':'≯',ngt:'≯',lteq:'≤',leq:'≤','!nlteq':'≤','!nleq':'≤','!lteq':'≰','!leq':'≰',nlteq:'≰',nleq:'≰',gteq:'≥',geq:'≥','!ngteq':'≥','!ngeq':'≥','!gteq':'≱','!geq':'≱',ngteq:'≱',ngeq:'≱',mlt:'≪',mgt:'≫',mmlt:'⋘',vmlt:'⋘',mmgt:'⋙',vmgt:'⋙',approxlt:'≲','!napproxlt':'≲','!approxlt':'≴',napproxlt:'≴',approxgt:'≳','!napproxgt':'≳','!approxgt':'≵',napproxgt:'≵',maybeeq:'≟',maybelt:'⩻',maybegt:'⩼',wreath:'≀',wreathproduct:'≀',ltimes:'⋉',lsemidirectproduct:'⋉',rtimes:'⋊',rsemidirectproduct:'⋊',btimes:'⨲',bsemidirectproduct:'⨲',lthree:'⋋',rthree:'⋌',normalsubgroup:'⊲','!nnormalsubgroup':'⊲','!normalsubgroup':'⋪',nnormalsubgroup:'⋪',normalsubgroupeq:'⊴','!nnormalsubgroupeq':'⊴','!normalsubgroupeq':'⋬',nnormalsubgroupeq:'⋬',containsnormalsubgroup:'⊳','!ncontainsnormalsubgroup':'⊳','!containsnormalsubgroup':'⋫',ncontainsnormalsubgroup:'⋫',containsnormalsubgroupeq:'⊵','!ncontainsnormalsubgroupeq':'⊵','!containsnormalsubgroupeq':'⋭',ncontainsnormalsubgroupeq:'⋭',null:'∅',emptyset:'∅',cap:'∩',intersection:'∩',cup:'∪',union:'∪',in:'∈','!nin':'∈','!in':'∉',nin:'∉',contains:'∋','!ncontains':'∋','!contains':'∌',ncontains:'∌',setminus:'∖',compliment:'∁',subset:'⊂','!nsubset':'⊂','!subset':'⊄',nsubset:'⊄',superset:'⊃',supset:'⊃','!nsuperset':'⊃','!nsupset':'⊃','!superset':'⊄','!supset':'⊄',nsuperset:'⊄',nsupset:'⊄',subseteq:'⊆','!nsubseteq':'⊆','!subseteq':'⊈',nsubseteq:'⊈',superseteq:'⊇',supseteq:'⊇','!nsuperseteq':'⊇','!nsupseteq':'⊇','!superseteq':'⊉','!supseteq':'⊉',nsuperseteq:'⊉',nsupseteq:'⊉',forall:'∀',exists:'∃','!nexists':'∃','!exists':'∄',nexists:'∄',mflat:'♭',mnat:'♮',msharp:'♯',tombstone:'∎',qed:'∎',QED:'∎',blacksquare:'∎',therefore:'∴',because:'∵',star:'⋆',diamond:'⋄',section:'§',pilcrow:'¶',paragraph:'¶',copy:'©',copyright:'©',copyleft:'🄯',currency:'¤'}
        ;
        const IDENTIFIERS: {[key: string]: string} =
            {Alpha:'Α',alpha:'α',Beta:'Β',beta:'β',Gamma:'Γ',gamma:'γ',Delta:'Δ',delta:'δ',Epsilon:'Ε',epsilon:'ε',Zeta:'Ζ',zeta:'ζ',Eta:'Η',eta:'η',Theta:'Θ',theta:'θ',Iota:'Ι',iota:'ι',Kappa:'Κ',kappa:'κ',Lambda:'Lamda',lambda:'lamda',Mu:'Μ',mu:'μ',Nu:'Ν',nu:'ν',Xi:'Ξ',xi:'ξ',Omicron:'Ο',omicron:'ο',Pi:'Π',pi:'π',Rho:'Ρ',rho:'ρ',Sigma:'Σ',sigma:'σ',altsigma:'ς',Tau:'Τ',tau:'τ',Upsilon:'Υ',upsilon:'υ',Phi:'Φ',phi:'φ',Chi:'Χ',chi:'χ',Psi:'Ψ',psi:'ψ',Omega:'Ω',omega:'ω',varbeta:'ϐ',vartheta:'ϑ',varupsilon:'ϒ',varphi:'ϕ',varkappa:'ϰ',varrho:'ϱ',Vartheta:'ϴ',varepsilon:'ϵ',rvarepsilon:'϶',infty:'∞',infinity:'∞',aleph:'ℵ',beth:'ℶ',i:'i',j:'j',dotlessi:'𝚤',dotlessj:'𝚥',hbar:'ℏ',Thorn:'Þ',thorn:'þ',Eth:'Ð',eth:'ð'}
        ;

        export const TOKENS = Object.assign(Object.create(null) as object, {
            '': /\s+(?<text>)/,
            __number__: /(?:0x[a-f0-9]+|0o[0-7]+|0b[01]+|[0-9]+(?:\.[0-9]*)?|\.[0-9]+)/i,
            __text__: /"[^"]*"/,
            __whitespace__: /\\(?<text>\s)/,
            __symbol__:  /\\(?<text>[^a-z])|(?<text>[^a-z\\{}"_^&%$])/i,
            __group_start__: /{/,
            __group_end__: /}/,
            __superscript__: /\^/,
            __subscript__: /_/,
            __callback__: /\\[a-z]+/i,
            __identifier__: /[a-z]+'*/i,
            __reserved__: /[\\{}"_^&%$]/
        } as const);

        const {invokeCallback, peekToken, acceptToken, expectToken, unwrapAndExpectToken, SyntaxPrimitives} = Willow.Internals;
        import MathMLNode = Willow.Internals.MathMLNode;

        export const CALLBACKS = Object.assign(Object.create(null) as object, {
            __root_inline__: tokens => [new MathMLNode('math', ...SyntaxPrimitives.math(tokens), {display: 'inline'})],
            __root_block__: tokens => [new MathMLNode('math', ...SyntaxPrimitives.math(tokens), {display: 'block'})],
            //////////////////////////////////////////////////////
            __whitespace__: tokens => expectToken('__whitespace__', tokens) && [new MathMLNode('mspace', {width: '1ch'})],
            __number__: tokens => [new MathMLNode('mn', expectToken('__number__', tokens).text)],
            __text__: tokens => [new MathMLNode('mtext', expectToken('__text__', tokens).text.replace(/^"(.*)"$/, "$1"))],
            __symbol__: tokens => [new MathMLNode('mo', expectToken('__symbol__', tokens).text)],
            __identifier__: tokens => [new MathMLNode('mi', expectToken('__identifier__', tokens).text)],
            //////////////////////////////////////////////////////
            Willow: [new MathMLNode('mtext', '\ud835\udcb2\ud835\udcbe\ud835\udcc1\ud835\udcc1\u2134\ud835\udccc')],
            //////////////////////////////////////////////////////
            u(tokens) {
                const char = String.fromCodePoint(parseInt(unwrapAndExpectToken('__number__', tokens).text));
                return TOKENS['__reserved__'].test(char) ? [new MathMLNode('mo', char)] : SyntaxPrimitives.expression(Util.createPeekableIterator(tokenize(char)));
            },
            not(tokens) {
                const callback = unwrapAndExpectToken('__callback__', tokens);
                const name = '!' + callback.text.slice(1);
                return name in CALLBACKS ? invokeCallback(name, tokens, callback.pos) : Util.throws(new Error(`Cannot negate callback '${name}' at position ${callback.pos}`));
            },
            //////////////////////////////////////////////////////
            sqrt: tokens => [new MathMLNode('msqrt', ...SyntaxPrimitives.expression(tokens))],
            frac: tokens => [new MathMLNode('mfrac', new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens)), new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens)))],
            root: (tokens, n: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens)), base: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens))) => [new MathMLNode('mroot', base, n)],
            //////////////////////////////////////////////////////
            underover: (tokens, base: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens)), under: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens)), over: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens))) => [new MathMLNode('munderover', base, under, over)],
            under: (tokens, base: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens)), under: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens))) => [new MathMLNode('munder', base, under)],
            over: (tokens, base: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens)), over: MathMLNode = new MathMLNode('mrow', ...SyntaxPrimitives.expression(tokens))) => [new MathMLNode('mover', base, over)],
            //////////////////////////////////////////////////////
            sum: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∑')),
            prod: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∏')),
            coprod: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∐')),
            //////////////////////////////////////////////////////
            int: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∫')),
            iint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∬')),
            iiint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∭')),
            iiiint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '⨌')),
            cwint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∱')),
            ccwint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '⨑')),
            cwoint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∲')),
            ccwoint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∳')),
            oint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∮')),
            oiint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∯')),
            oiiint: tokens => invokeCallback('underover', tokens, -1, new MathMLNode('mo', '∰')),
            //////////////////////////////////////////////////////
            color: (tokens, color: string = unwrapAndExpectToken('__identifier__', tokens).text, contents: MathMLNode[] = SyntaxPrimitives.expression(tokens)) => [new MathMLNode('mstyle', ...contents, {style: `color: ${color};`})],
            //////////////////////////////////////////////////////
            g: (tokens, left: MathMLNode[] = [], right: MathMLNode[] = []) => [new MathMLNode('mrow', ...left, ...SyntaxPrimitives.expression(tokens), ...right)],
            left(tokens) {
                const nodes = [];
                while(peekToken('*', tokens) && !peekToken('__group_end__', tokens)) {
                    if(peekToken('__callback__', tokens)?.text.slice(1) === 'right') {
                        expectToken('__callback__', tokens);
                        return [new MathMLNode('mrow', ...nodes, ...SyntaxPrimitives.maybescriptexpr(tokens))];
                    } else {
                        nodes.push(...SyntaxPrimitives.maybescriptexpr(tokens));
                    }
                }
                throw new Error(`Unpaired 'left' callback`);
            },
            right: _tokens => Util.throws(new Error(`Unpaired 'right' callback`)),
            paren: tokens => invokeCallback('g', tokens, -1, invokeCallback('lparen', tokens, -1), invokeCallback('rparen', tokens, -1)),
            abs: tokens => invokeCallback('g', tokens, -1, invokeCallback('lpipe', tokens, -1), invokeCallback('rpipe', tokens, -1)),
            //////////////////////////////////////////////////////
            ...Object.fromEntries(Object.entries(SYMBOLS).map(([k,v])=>[k, [new MathMLNode('mo', v)]])),
            ...Object.fromEntries(Object.entries(IDENTIFIERS).map(([k,v])=>[k, [new MathMLNode('mi', v)]])),
        } as {[key: string]: MathMLNode[] | ((tokens: Util.PeekableIterableIterator<Token>, ...args: unknown[])=>MathMLNode[])});        
    }
    
    function tokenize(text: string): Token[] {
        const tokens = [];
        main: for(let pos = 0; pos < text.length; pos++) {
            let match;
            for(const [name, pattern] of Object.entries(Willow.Config.TOKENS)) {
                if(match = text.slice(pos).match(new RegExp(`^(?:${pattern.source})`, pattern.flags))) {
                    if(!match.length) {
                        throw new Error(`Token pattern '${name}' matched empty string`);
                    }

                    const text = match.groups?.text ?? match[0];
                    if(text.length) {
                        tokens.push(new Token(name, text, pos));
                        pos += match[0].length - 1;
                    }
                    continue main;
                }
            }

            throw new Error(`Unexpected character '${text[pos]}' at position ${pos}`);
        }
        return tokens;
    }

    export function parse(text: string, {display = 'inline', target = 'string'}: {display?: 'inline' | 'block', target?: 'string' | 'dom'} = {}) {
        const tokens = Util.createPeekableIterator(tokenize(text));
        const [root] = Willow.Internals.invokeCallback(`__root_${display}__`, tokens, 0);
        Willow.Internals.expectToken(undefined, tokens);
        return target === 'string' ? root.toString() : root.toMathMLElement();
    }
}

// === TODO ===
// + \text{} fonts
// + Letters like AE, upsidedown letters and punctuation, modifiers (accents, hats, etc...)
// + Improve error messages (e.g. a^b^c, and a few missing positions)
// + Add fancy directional quote symbols
// + N-arys (⋀ ⋁ ⋂ ⋃ etc...) and more symbols?
// + Matrices, binomials