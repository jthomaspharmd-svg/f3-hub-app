import { v4 as uuidv4 } from 'uuid';
import type { WorkoutSession } from './types';

// Data provided by the user
const rawData = `
3/25/25 (Tue)	530	Bic	BQ	Big Sky	
3/27/25 (Thu)	530	Big Sky	VQ	Crab Legs	
3/29/25 (Sat)	630	Zindler	TIR		
4/1/25 (Tue)	530	Bubba	GQ		
4/3/25 (Thu)	530	Crabs			
4/5/25 (Sat)	630	Swinger	SQ	HALLPASS	HALLPASS
4/8/25 (Tue)	530	Crab Legs		Crab Legs	
4/10/25 (Thu)	530	Hall Pass		HAPLESS LEGS	
4/12/25 (Sat)	630	Vespa		HALLPASS	HALLPASS
4/15/25 (Tue)	530	Aquaman		Crab Legs	
4/17/25 (Thu)	530	Alcatraz		Alcatraz	
4/19/25 (Sat)	630	Zindler		Zindler	
4/22/25 (Tue)	530	Krank	GQ	Zindler	
4/24/25 (Thu)	530	Pink Slip	GQ		
4/26/25 (Sat)	630	Castaway		Crab Legs	
4/29/25 (Tue)	530	Alcatraz		Alcatraz	
5/1/25 (Thu)	530	HALLPASS		HALLPASS	
5/3/25 (Sat)	630	Zindler		Zindler	
5/6/25 (Tue)	530	Krank	GQ 	Crab Legs 	
5/8/25 (Thu)	530	Big Sky			
5/10/25 (Sat)	630	Vespa	AQ (2 yr)	ZindlerHALLPASS	Zindler
5/13/25 (Tue)	530	Crab Legs		Crab Legs	
5/15/25 (Thu)	530	HT			
5/17/25 (Sat)	630	Vespa			
5/20/25 (Tue)	530	Hall Pass		HALLPASS	
5/22/25 (Thu)	530	Test Tube		Crab Legs	
5/24/25 (Sat)	630	HT			
5/27/25 (Tue)	530	Alcatraz 		Alcatraz	
5/29/25 (Thu)	530	Bic			
5/31/25 (Sat)	630	Hardwood	2..0		Hardwood 
6/3/25 (Tue)	530	Crabs			
6/5/25 (Thu)	530	TNR	VQ	HALLPASS	
6/7/25 (Sat)	630	Vespa			
6/10/25 (Tue)	530	Castaway			
6/12/25 (Thu)	530	Rusty	GQ	HALLPASS	
6/14/25 (Sat)	630	TNR	2..0		
6/17/25 (Tue)	530	Alcatraz		HALLPASS	
6/19/25 (Thu)	530	Crab Legs		Crab Legs	
6/21/25 (Sat)	630	Vespa			
6/24/25 (Tue)	530	HALLPASS			
6/26/25 (Thu)	530	Hertz	GQ		
6/28/25 (Sat)	630	Castaway			
7/1/25 (Tue)	530	Drano	GQ		
7/3/25 (Thu)	530	Camelbak	GQ		
7/5/25 (Sat)	630	TNR			
7/8/25 (Tue)	530	CRABS			
7/10/25 (Thu)	530	Hardwood		Hardwood	
7/12/25 (Sat)	630	Big Sky	AQ		
7/15/25 (Tue)	530	HALLPASS			
7/17/25 (Thu)	530	Camelbak	GQ		
7/19/25 (Sat)	630	Bic			
7/22/25 (Tue)	530	BIG SKY		HALLPASS	
7/24/25 (Thu)	530	Vespa		Alcatraz	
7/26/25 (Sat)	630	HT		ZINDLER 	
7/29/25 (Tue)	530	Alcatraz 	AQ	Alcatraz	
7/31/25 (Thu)	530	Swangset	VQ!!!!		
8/2/25 (Sat)	630	Vespa			
8/5/25 (Tue)	530	HALLPASS		Hardwood	
8/7/25 (Thu)	530	Big Sky			
8/9/25 (Sat)	630	Aquaman			
8/12/25 (Tue)	530	 Vespa			
8/14/25 (Thu)	530	Bic			
8/16/25 (Sat)	630	ZINDLER 			
8/19/25 (Tue)	530	Crabs			
8/21/25 (Thu)	530	Alcatraz			
8/23/25 (Sat)	630	Rook	2.0*		
8/26/25 (Tue)	530	Vespa			
8/28/25 (Thu)	530	ZINDLER	AQ		
8/30/25 (Sat)	630	AO Games?			
9/2/25 (Tue)	530	HALLPASS			
9/4/25 (Thu)	530	Castaway			
9/6/25 (Sat)	630	HT			
9/9/25 (Tue)	530	Vespa			
9/11/25 (Thu)	530	Crab Legs			
9/13/25 (Sat)	630	Bic	AQ		
9/16/25 (Tue)	530	Alcatraz			
9/18/25 (Thu)	530	Krank	GQ		
9/20/25 (Sat)	630	Vespa 			
9/23/25 (Tue)	530	Woodglue!!!			
9/25/25 (Thu)	530	Zeus ⚡️⚡️⚡️			
9/27/25 (Sat)	630	HALLPASS			
9/30/25 (Tue)	530	FlexSteel	VQ/BQ!!!		
10/2/25 (Thu)	530	Alcatraz			
10/4/25 (Sat)	630	Hardwood		Hallpass	
10/7/25 (Tue)	530	Franzia	GQ		
10/9/25 (Thu)	530	 Crab Legs			
10/11/25 (Sat)	630	Tuck N Roll			
10/14/25 (Tue)	530	Vespa	1 year sober 		
10/16/25 (Thu)	530	HT			
10/18/25 (Sat)	630	Test Tube			
10/21/25 (Tue)	530	HALLPASS			
10/23/25 (Thu)	530	aquaman	why not?		
10/25/25 (Sat)	630	Vespa	It was empty		
10/28/25 (Tue)	530	Alcatraz			
10/30/25 (Thu)	530	Hardwood	AQ (1 Yr)		
11/1/25 (Sat)	630	Vespa			
11/4/25 (Tue)	530	Franzia			
11/6/25 (Thu)	530	Octagon 	VQ/BQ		
11/8/25 (Sat)	630	Bill Nye	VQ		
11/11/25 (Tue)	530	Crab Legs			
11/13/25 (Thu)	530	 Blackout			
11/15/25 (Sat)	630	Tuck N Roll			
11/18/25 (Tue)	530	Alcatraz			
11/20/25 (Thu)	530	Pink slip	GQ		
11/22/25 (Sat)	630	Vespa			
11/25/25 (Tue)	530				
11/27/25 (Thu)	530				
11/29/25 (Sat)	630	Swinger	DQ. That's what I like about Texas		
12/2/25 (Tue)	530	Tuck N Roll	BQ!		
12/4/25 (Thu)	530				
12/6/25 (Sat)	630				
12/9/25 (Tue)	530	Franzia			
12/11/25 (Thu)	530				
12/13/25 (Sat)	630				
12/16/25 (Tue)	530				
12/18/25 (Thu)	530	Hardwood 			
12/20/25 (Sat)	630				
12/23/25 (Tue)	530				
12/25/25 (Thu)	530				
12/27/25 (Sat)	630				
12/30/25 (Tue)	530				
1/1/26 (Thu)	530				
1/3/26 (Sat)	630				
1/6/26 (Tue)	530				
1/8/26 (Thu)	530				
1/10/26 (Sat)	630				
1/13/26 (Tue)	530				
1/15/26 (Thu)	530	HALLPASS	AQ
`;

export const initialQSheetData: WorkoutSession[] = rawData
  .trim()
  .split('\n')
  .map(line => {
    const [date, time, q, notes, dbj, food] = line.split('\t');
    const formattedTime = time === '530' ? '0530' : '0630';
    return {
      id: uuidv4(),
      date: date.trim(),
      time: formattedTime,
      q: q?.trim() || '',
      notes: notes?.trim() || '',
      dbj: dbj?.trim() || '',
      food: food?.trim() || '',
    };
  });
