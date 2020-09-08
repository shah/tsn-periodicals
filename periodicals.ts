import * as cc from "@shah/ts-content-classification";
import * as atc from "@shah/tsn-content-classification-html-anchors";

// TODO: classify duplicates and add ability to handle duplicates
// TODO: consider creating a persistence adapter for Microsoft TODO / OpenProject

export type ClassifiedAnchorText = atc.ClassifiedAnchorText<any> | atc.UnclassifiedAnchorText;

// a URL that is found in the content of a periodical
export interface UniformResourceLocation {
    readonly href: string;
}

// Structurally, HtmlAnchor should be identical to @shah/queryable-content:HtmlAnchor
// so that anchors from @shah/queryable-content can be used but @shah/queryable-content
// does not need to be a dependency
export interface HtmlAnchor extends UniformResourceLocation {
    readonly label?: string;
}

export interface PeriodicalAnchor {
    readonly isPeriodicalAnchor: true,
    readonly anchorText: string;
    count: number;
}

export function isPeriodicalAnchor(o: any): o is PeriodicalAnchor {
    return o && "isPeriodicalAnchor" in o;
}

export interface ClassifiedPeriodicalAnchor extends PeriodicalAnchor {
    readonly isClassifiedPeriodicalAnchor: true,
    readonly classification: ClassifiedAnchorText;
    readonly count: number;
}

export function isClassifiedPeriodicalAnchor(o: any): o is ClassifiedPeriodicalAnchor {
    return o && "ClassifiedPeriodicalAnchor" in o;
}

export interface PeriodicalSuppliers {
    [name: string]: PeriodicalSupplier;
}

export interface PeriodicalSupplier {
    readonly name: string;
    readonly periodicals: { [name: string]: Periodical };
    registerPeriodical(name: string): Periodical;
    classifyAnchors(): Promise<void>;
}

export interface PeriodicalCommonAnchor extends ClassifiedPeriodicalAnchor {
    readonly isPeriodicalCommonAnchor: true;
}

export function isPeriodicalCommonAnchor(o: ClassifiedPeriodicalAnchor): o is PeriodicalCommonAnchor {
    return "isPeriodicalCommonAnchor" in o;
}

export interface Periodical {
    readonly name: string;
    readonly editions: PeriodicalEdition[];
    readonly classifiedAnchors: { [anchorText: string]: ClassifiedPeriodicalAnchor };
    registerEdition(edition: PeriodicalEdition): PeriodicalEdition;
    registerAnchor(anchor: HtmlAnchor): ClassifiedAnchor;
    classifyAnchorText(anchorText: string): ClassifiedAnchorText;
    classifyAnchors(): Promise<void>;
}

export interface ClassifiedAnchor extends HtmlAnchor {
    readonly classifierText: string;
    readonly classifiedBy?: ClassifiedPeriodicalAnchor;
    readonly classification: ClassifiedAnchorText;
}

export interface PeriodicalEdition {
    readonly supplierContentId: string;
    readonly fromAddress: string;
    readonly fromName: string;
    readonly date: Date;
    readonly anchors: ClassifiedAnchor[];
}

export class TypicalPeriodicalSupplier implements PeriodicalSupplier {
    readonly periodicals: { [name: string]: Periodical } = {};

    constructor(
        readonly name: string,
        readonly atcRulesEngine: atc.AnchorTextRuleEngine,
        readonly atcClassifier: atc.AnchorTextClassifier) {
    }

    registerPeriodical(periodicalName: string): Periodical {
        let result = this.periodicals[periodicalName];
        if (!result) {
            result = new TypicalPeriodical(periodicalName, this.atcRulesEngine, this.atcClassifier);
            this.periodicals[periodicalName] = result;
        }
        return result;
    }

    async classifyAnchors(): Promise<void> {
        for (const p of Object.values(this.periodicals)) {
            await p.classifyAnchors();
        }
    }
}

export class TypicalPeriodical implements Periodical {
    readonly editions: PeriodicalEdition[] = [];
    protected readonly unclassifiedAnchors: { [anchorText: string]: PeriodicalAnchor } = {};
    readonly classifiedAnchors: { [anchorText: string]: ClassifiedPeriodicalAnchor } = {};
    readonly nameMatcher: cc.FlexMatch;

    constructor(readonly name: string,
        readonly atcRulesEngine: atc.AnchorTextRuleEngine,
        readonly atcClassifier: atc.AnchorTextClassifier) {
        this.nameMatcher = cc.exactMatch(this.name);
    }

    protected classifierAnchorText(anchor: HtmlAnchor): string {
        return anchor.label ? anchor.label.replace(/(\r\n|\n|\r|\t)/gm, " ").trim().toLocaleLowerCase() : "";
    }

    classifyAnchorText(anchorText: string): ClassifiedAnchorText {
        const context: atc.AnchorTextClassifierContext = {
            anchorText: anchorText,
            engine: this.atcRulesEngine,
            periodicalName: this.nameMatcher,
        }
        return this.atcClassifier.classify(context);
    }

    registerEdition(edition: PeriodicalEdition): PeriodicalEdition {
        this.editions.push(edition);
        return edition;
    }

    registerAnchor(anchor: HtmlAnchor): ClassifiedAnchor {
        const classifierAnchorText = this.classifierAnchorText(anchor);
        if (classifierAnchorText.length > 0) {
            const aa = this.unclassifiedAnchors[classifierAnchorText];
            if (aa) {
                aa.count++;
            } else {
                this.unclassifiedAnchors[classifierAnchorText] = {
                    isPeriodicalAnchor: true,
                    anchorText: classifierAnchorText,
                    count: 1,
                }
            }
        }
        return {
            ...anchor,
            classifierText: classifierAnchorText,
            classification: atc.unclassifiedAnchorText(classifierAnchorText)
        };
    }

    async classifyAnchors(): Promise<void> {
        for (const ua of Object.values(this.unclassifiedAnchors)) {
            const classification = this.classifyAnchorText(ua.anchorText);
            let classified: ClassifiedPeriodicalAnchor | PeriodicalCommonAnchor = {
                ...ua,
                isClassifiedPeriodicalAnchor: true,
                classification: classification
            };
            if (classified.count > 1 && classified.count == this.editions.length) {
                classified = {
                    isPeriodicalCommonAnchor: true,
                    ...classified,
                }
            }
            this.classifiedAnchors[classified.anchorText] = classified;
        }
        for (const pe of this.editions) {
            pe.anchors.forEach(async (ca, index, array) => {
                const periodicalAnchor = this.classifiedAnchors[ca.classifierText];
                if (periodicalAnchor && cc.isClassifiedContent(periodicalAnchor.classification)) {
                    array[index] = {
                        ...ca,
                        classifiedBy: periodicalAnchor,
                        classification: periodicalAnchor.classification
                    };
                } else {
                    const classification = this.classifyAnchorText(ca.classifierText);
                    array[index] = {
                        ...ca,
                        classification: classification
                    };
                }
            })
        }
    }
}

